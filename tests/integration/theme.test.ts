import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  DEFAULT_BRAND,
  THEME_PRESETS,
  buildThemeCss,
  parseHsl,
} from "@/lib/domain/theme";
import { systemContext, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS } from "@/server/services/activity";
import { listActivity } from "@/server/services/activity-queries";
import { seedOrgSettings } from "@/server/services/settings";
import {
  DEFAULT_THEME,
  applyThemePreset,
  getEffectiveThemeMode,
  getThemeCss,
  getThemeSettings,
  getUserThemeMode,
  resetThemeSettings,
  setUserThemeMode,
  updateThemeSettings,
} from "@/server/services/theme";

/**
 * Phase 12 integration tests — theme and branding.
 *
 * NET-NEW (audit §15, line 37): legacy had one fixed palette compiled into
 * `webapp/Styles.html`, so nothing here is a parity test. What these assert is
 * that the two scopes stay apart — an organization's brand, and a person's own
 * light/dark choice — and that neither leaks across a tenant boundary.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-theme";
const RIVAL_SLUG = "test-org-theme-rival";
const EMAIL_DOMAIN = "@theme-test.example.com";

let ctx: OrgContext;
let rivalCtx: OrgContext;
/** An organization deliberately created with NO ThemeSettings row. */
let bareCtx: OrgContext;
let secondUserId: string;

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, RIVAL_SLUG, `${SLUG}-bare`] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

async function buildOrg(
  slug: string,
  name: string,
  prefix: string,
  withTheme = true,
) {
  const org = await prisma.organization.create({
    data: { name, slug, ...(withTheme ? { theme: { create: {} } } : {}) },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: `${prefix} Owner`,
      email: `${prefix}-owner${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true, name: true, email: true },
  });
  const member = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", 1),
      role: OrgRole.OWNER,
    },
    select: { id: true },
  });

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 1 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
    ],
  });

  const context: OrgContext = {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
    role: OrgRole.OWNER,
  };

  return { org, context };
}

const inputFrom = (
  overrides: Partial<Parameters<typeof updateThemeSettings>[1]> = {},
) => ({
  preset: "custom",
  primaryColor: DEFAULT_BRAND.primary,
  secondaryColor: DEFAULT_BRAND.secondary,
  accentColor: DEFAULT_BRAND.accent,
  sidebarColor: DEFAULT_BRAND.sidebar,
  backgroundColor: DEFAULT_BRAND.background,
  defaultMode: "system" as const,
  logoUrl: null,
  ...overrides,
});

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const main = await buildOrg(SLUG, "Theme Test Org", "primary");
  ctx = main.context;

  const rival = await buildOrg(RIVAL_SLUG, "Rival Org", "rival");
  rivalCtx = rival.context;

  const bare = await buildOrg(`${SLUG}-bare`, "Bare Org", "bare", false);
  bareCtx = bare.context;

  const second = await prisma.user.create({
    data: {
      name: "Sam Second",
      email: `primary-second${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true },
  });
  secondUserId = second.id;
  await prisma.organizationMember.create({
    data: {
      organizationId: ctx.organizationId,
      userId: second.id,
      displayId: formatDisplayId("MEMBER", 2),
      role: OrgRole.ACCOUNTANT,
    },
  });
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!hasDatabase) return;
  await prisma.themeSettings.updateMany({
    where: {
      organizationId: { in: [ctx.organizationId, rivalCtx.organizationId] },
    },
    data: {
      preset: DEFAULT_THEME.preset,
      primaryColor: DEFAULT_BRAND.primary,
      secondaryColor: DEFAULT_BRAND.secondary,
      accentColor: DEFAULT_BRAND.accent,
      sidebarColor: DEFAULT_BRAND.sidebar,
      backgroundColor: DEFAULT_BRAND.background,
      defaultMode: "system",
    },
  });
  await prisma.dashboardPreference.deleteMany({
    where: { userId: { in: [ctx.userId!, secondUserId, rivalCtx.userId!] } },
  });
  // Activity is cumulative, and several tests below assert an exact count of
  // Theme Changed entries. Without this they would pass or fail depending on
  // which tests ran before them.
  await prisma.activityLog.deleteMany({
    where: {
      organizationId: {
        in: [ctx.organizationId, rivalCtx.organizationId, bareCtx.organizationId],
      },
    },
  });
});

suite("getThemeSettings", () => {
  it("returns the stock palette for a fresh organization", async () => {
    expect(await getThemeSettings(ctx)).toEqual(DEFAULT_THEME);
  });

  it("returns the stock palette for an organization with NO theme row", async () => {
    // Possible for anything created before this phase. Callers must never
    // have to handle a null theme.
    expect(
      await prisma.themeSettings.findUnique({
        where: { organizationId: bareCtx.organizationId },
      }),
    ).toBeNull();

    expect(await getThemeSettings(bareCtx)).toEqual(DEFAULT_THEME);
  });

  it("falls back per slot when a stored colour is corrupt", async () => {
    // Written directly, bypassing validation — the read path re-validates
    // because the value ends up in a stylesheet.
    await prisma.themeSettings.update({
      where: { organizationId: ctx.organizationId },
      data: {
        primaryColor: "}</style><script>alert(1)</script>",
        sidebarColor: "158 64% 30%",
      },
    });

    const theme = await getThemeSettings(ctx);
    expect(theme.primary).toBe(DEFAULT_BRAND.primary);
    // One bad value does not discard the good ones beside it.
    expect(theme.sidebar).toBe("158 64% 30%");

    const css = await getThemeCss(ctx);
    expect(css).not.toContain("<");
    expect(css).not.toContain("script");
  });

  it("falls back on a corrupt default mode rather than throwing", async () => {
    await prisma.themeSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { defaultMode: "sepia" },
    });

    expect((await getThemeSettings(ctx)).defaultMode).toBe("system");
  });
});

suite("getThemeCss", () => {
  it("emits nothing while the organization is on the stock palette", async () => {
    expect(await getThemeCss(ctx)).toBe("");
  });

  it("emits both blocks once the palette is customised", async () => {
    await applyThemePreset(ctx, "forest");

    const css = await getThemeCss(ctx);
    expect(css).toContain(":root{");
    expect(css).toContain(".dark{");
    expect(css).toContain("--primary:");
  });

  it("matches what the domain builder produces from the same values", async () => {
    // The settings form previews with buildThemeVariables; if the service
    // diverged, an administrator would approve one palette and ship another.
    await applyThemePreset(ctx, "plum");
    const theme = await getThemeSettings(ctx);

    expect(await getThemeCss(ctx)).toBe(buildThemeCss(theme));
  });
});

suite("updateThemeSettings", () => {
  it("stores every colour and the default mode", async () => {
    await updateThemeSettings(
      ctx,
      inputFrom({
        primaryColor: "271 55% 45%",
        sidebarColor: "270 35% 15%",
        defaultMode: "dark",
      }),
    );

    const theme = await getThemeSettings(ctx);
    expect(theme.primary).toBe("271 55% 45%");
    expect(theme.sidebar).toBe("270 35% 15%");
    expect(theme.defaultMode).toBe("dark");
    expect(theme.preset).toBe("custom");
  });

  it("creates the row for an organization that has none", async () => {
    // Upsert, not update: failing here would be a defect the administrator
    // cannot work around.
    await updateThemeSettings(bareCtx, inputFrom({ primaryColor: "158 64% 30%" }));

    expect((await getThemeSettings(bareCtx)).primary).toBe("158 64% 30%");
  });

  it("writes one Theme Changed entry naming what changed", async () => {
    await updateThemeSettings(
      ctx,
      inputFrom({ preset: "forest", primaryColor: "158 64% 30%" }),
    );

    const activity = await listActivity(ctx, {
      page: 1,
      action: ACTIVITY_ACTIONS.THEME_CHANGED,
    } as Parameters<typeof listActivity>[1]);

    expect(activity.total).toBe(1);
    expect(activity.rows[0]?.comment).toContain("preset");
    expect(activity.rows[0]?.comment).toContain("primary");
    expect(activity.rows[0]?.newValue).toBe("forest");
  });

  it("logs nothing when the submission changes nothing — idempotent", async () => {
    const before = await getThemeSettings(ctx);
    const input = inputFrom({
      preset: before.preset,
      primaryColor: before.primary,
      secondaryColor: before.secondary,
      accentColor: before.accent,
      sidebarColor: before.sidebar,
      backgroundColor: before.background,
      defaultMode: before.defaultMode,
    });

    await updateThemeSettings(ctx, input);
    await updateThemeSettings(ctx, input);

    const activity = await listActivity(ctx, {
      page: 1,
      action: ACTIVITY_ACTIONS.THEME_CHANGED,
    } as Parameters<typeof listActivity>[1]);
    expect(activity.total).toBe(0);
    expect(await getThemeSettings(ctx)).toEqual(before);
  });

  it("is idempotent when the same change is applied twice", async () => {
    const input = inputFrom({ preset: "slate", primaryColor: "215 25% 35%" });

    await updateThemeSettings(ctx, input);
    const afterFirst = await getThemeSettings(ctx);
    await updateThemeSettings(ctx, input);
    const afterSecond = await getThemeSettings(ctx);

    expect(afterSecond).toEqual(afterFirst);

    // And only the first run is worth an audit entry.
    const activity = await listActivity(ctx, {
      page: 1,
      action: ACTIVITY_ACTIONS.THEME_CHANGED,
    } as Parameters<typeof listActivity>[1]);
    expect(activity.total).toBe(1);
  });

  it("saves the logo onto the organization, not onto the theme", async () => {
    await updateThemeSettings(
      ctx,
      inputFrom({ logoUrl: "https://example.com/logo.svg" }),
    );

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { logoUrl: true },
    });
    expect(organization.logoUrl).toBe("https://example.com/logo.svg");

    await updateThemeSettings(ctx, inputFrom({ logoUrl: null }));
    expect(
      (
        await prisma.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { logoUrl: true },
        })
      ).logoUrl,
    ).toBeNull();
  });

  it("touches only the caller's organization", async () => {
    await updateThemeSettings(ctx, inputFrom({ primaryColor: "0 100% 50%" }));

    expect((await getThemeSettings(ctx)).primary).toBe("0 100% 50%");
    expect((await getThemeSettings(rivalCtx)).primary).toBe(
      DEFAULT_BRAND.primary,
    );
    expect(await getThemeCss(rivalCtx)).toBe("");
  });

  it("records the change under the acting organization only", async () => {
    await updateThemeSettings(ctx, inputFrom({ primaryColor: "0 100% 50%" }));

    const theirs = await listActivity(rivalCtx, {
      page: 1,
      action: ACTIVITY_ACTIONS.THEME_CHANGED,
    } as Parameters<typeof listActivity>[1]);
    expect(theirs.total).toBe(0);
  });

  it("attributes a scheduled change to the system, not to a person", async () => {
    // Nothing schedules a theme change today, but the service must not
    // fabricate a user id if something ever does — ActivityLog.userId is a
    // real foreign key.
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    await updateThemeSettings(jobCtx, inputFrom({ primaryColor: "199 89% 40%" }));

    const activity = await listActivity(ctx, {
      page: 1,
      action: ACTIVITY_ACTIONS.THEME_CHANGED,
    } as Parameters<typeof listActivity>[1]);
    expect(activity.rows[0]?.system).toBe(true);
  });
});

suite("applyThemePreset", () => {
  it("applies every declared preset", async () => {
    for (const preset of THEME_PRESETS) {
      await applyThemePreset(ctx, preset.id);
      const theme = await getThemeSettings(ctx);

      expect(theme.preset, preset.id).toBe(preset.id);
      expect(theme.primary, preset.id).toBe(preset.colors.primary);
      expect(theme.sidebar, preset.id).toBe(preset.colors.sidebar);
    }
  });

  it("ignores an unknown preset rather than clearing the palette", async () => {
    await applyThemePreset(ctx, "forest");
    const before = await getThemeSettings(ctx);

    await applyThemePreset(ctx, "definitely-not-a-preset");

    expect(await getThemeSettings(ctx)).toEqual(before);
  });

  it("keeps the organization's default mode and its logo", async () => {
    await updateThemeSettings(
      ctx,
      inputFrom({
        defaultMode: "dark",
        logoUrl: "https://example.com/keep.svg",
      }),
    );

    await applyThemePreset(ctx, "plum");

    const theme = await getThemeSettings(ctx);
    expect(theme.defaultMode).toBe("dark");
    expect(theme.primary).toBe("271 55% 45%");
    expect(
      (
        await prisma.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { logoUrl: true },
        })
      ).logoUrl,
    ).toBe("https://example.com/keep.svg");
  });
});

suite("resetThemeSettings", () => {
  it("returns to the stock palette and stops emitting CSS", async () => {
    await applyThemePreset(ctx, "forest");
    expect(await getThemeCss(ctx)).not.toBe("");

    await resetThemeSettings(ctx);

    expect(await getThemeSettings(ctx)).toEqual(DEFAULT_THEME);
    expect(await getThemeCss(ctx)).toBe("");
  });

  it("keeps the logo — that is identity, not palette", async () => {
    await updateThemeSettings(
      ctx,
      inputFrom({
        preset: "forest",
        primaryColor: "158 64% 30%",
        logoUrl: "https://example.com/logo.svg",
      }),
    );

    await resetThemeSettings(ctx);

    expect(
      (
        await prisma.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { logoUrl: true },
        })
      ).logoUrl,
    ).toBe("https://example.com/logo.svg");
  });

  it("is safe to run twice", async () => {
    await applyThemePreset(ctx, "slate");
    await resetThemeSettings(ctx);
    await resetThemeSettings(ctx);

    expect(await getThemeSettings(ctx)).toEqual(DEFAULT_THEME);
  });
});

suite("a person's own mode", () => {
  it("is null until they choose", async () => {
    expect(await getUserThemeMode(ctx)).toBeNull();
  });

  it("persists and can be changed", async () => {
    await setUserThemeMode(ctx, "dark");
    expect(await getUserThemeMode(ctx)).toBe("dark");

    await setUserThemeMode(ctx, "light");
    expect(await getUserThemeMode(ctx)).toBe("light");
  });

  it("upserts rather than duplicating on repeat writes", async () => {
    await setUserThemeMode(ctx, "dark");
    await setUserThemeMode(ctx, "dark");
    await setUserThemeMode(ctx, "system");

    expect(
      await prisma.dashboardPreference.count({
        where: { userId: ctx.userId!, dashboard: "appearance" },
      }),
    ).toBe(1);
  });

  it("is one person's alone", async () => {
    await setUserThemeMode(ctx, "dark");

    expect(await getUserThemeMode({ ...ctx, userId: secondUserId })).toBeNull();
  });

  it("refuses to store a choice for a scheduled run", async () => {
    // systemContext has no user id, and inventing one would violate the
    // foreign key rather than fail cleanly.
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    await expect(setUserThemeMode(jobCtx, "dark")).rejects.toThrow(
      /signed-in user/i,
    );
    expect(await getUserThemeMode(jobCtx)).toBeNull();
  });
});

suite("getEffectiveThemeMode", () => {
  it("uses the organization default when the person has not chosen", async () => {
    await updateThemeSettings(ctx, inputFrom({ defaultMode: "dark" }));

    const effective = await getEffectiveThemeMode(ctx);
    expect(effective.mode).toBe("dark");
    expect(effective.userMode).toBeNull();
    expect(effective.organizationDefault).toBe("dark");
  });

  it("lets a personal choice beat the organization default", async () => {
    await updateThemeSettings(ctx, inputFrom({ defaultMode: "dark" }));
    await setUserThemeMode(ctx, "light");

    const effective = await getEffectiveThemeMode(ctx);
    expect(effective.mode).toBe("light");
    expect(effective.organizationDefault).toBe("dark");
  });

  it("reaches everyone who has not chosen when the default changes", async () => {
    // The case a write-once design gets wrong: an administrator switching the
    // organization to dark must reach existing users, not only new browsers.
    const other = { ...ctx, userId: secondUserId };
    expect((await getEffectiveThemeMode(other)).mode).toBe("system");

    await updateThemeSettings(ctx, inputFrom({ defaultMode: "dark" }));

    expect((await getEffectiveThemeMode(other)).mode).toBe("dark");
  });

  it("follows the person across organizations while the brand does not", async () => {
    // Light-versus-dark is about their eyes and their screen, not about which
    // tenant they are working in.
    await setUserThemeMode(ctx, "dark");
    await updateThemeSettings(ctx, inputFrom({ primaryColor: "0 100% 50%" }));

    const elsewhere = await getEffectiveThemeMode({
      ...rivalCtx,
      userId: ctx.userId,
    });

    expect(elsewhere.mode).toBe("dark");
    expect((await getThemeSettings(rivalCtx)).primary).toBe(
      DEFAULT_BRAND.primary,
    );
  });

  it("falls back to system for a scheduled run with no user", async () => {
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    expect((await getEffectiveThemeMode(jobCtx)).mode).toBe("system");
  });
});

suite("derived output is sane against the database", () => {
  it("produces parseable channels for every emitted token", async () => {
    for (const preset of THEME_PRESETS) {
      await applyThemePreset(ctx, preset.id);
      const css = await getThemeCss(ctx);
      if (!css) continue;

      for (const [, value] of css.matchAll(/--[a-z-]+:([^;]+);/g)) {
        expect(parseHsl(value!), `${preset.id}: ${value}`).not.toBeNull();
      }
    }
  });
});
