import { EntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  DEFAULT_BRAND,
  buildThemeCss,
  isThemeMode,
  parseHsl,
  presetById,
  resolveThemeMode,
  type BrandColors,
  type ThemeMode,
} from "@/lib/domain/theme";
import type { UpdateThemeInput } from "@/lib/validation/theme";
import { requireUserId, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";

/**
 * Theme and branding.
 *
 * NET-NEW (audit §15). `ThemeSettings` and `DashboardPreference.themeMode`
 * have existed in the schema since Phase 1 and were deliberately left unread
 * until the phase that owns them; this file is what finally consumes both.
 *
 * Two scopes, and keeping them apart is the point:
 *
 *  - **The organization's brand** — colours, logo, and the default mode.
 *    Changing it changes what everybody sees, so it needs `branding:manage`.
 *  - **A person's light/dark choice** — theirs alone, needs no permission, and
 *    overrides the organization default without changing it for anyone else.
 */

/** The dashboard key the per-user mode is stored under. */
const THEME_PREFERENCE_KEY = "appearance";

export interface ThemeSettingsView extends BrandColors {
  preset: string;
  defaultMode: ThemeMode;
}

export const DEFAULT_THEME: ThemeSettingsView = {
  ...DEFAULT_BRAND,
  preset: "coreworks",
  defaultMode: "system",
};

/**
 * The organization's stored brand.
 *
 * Every colour is re-validated on the way out and falls back to the CoreWorks
 * default if it does not parse. An organization with no row at all — possible
 * for one created before this phase — reads as the defaults rather than as
 * null, so no caller has to handle an absent theme.
 */
export async function getThemeSettings(
  ctx: OrgContext,
): Promise<ThemeSettingsView> {
  const row = await prisma.themeSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: {
      preset: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      sidebarColor: true,
      backgroundColor: true,
      defaultMode: true,
    },
  });

  if (!row) return DEFAULT_THEME;

  const colour = (value: string, fallback: string) =>
    parseHsl(value) === null ? fallback : value;

  return {
    preset: row.preset,
    primary: colour(row.primaryColor, DEFAULT_BRAND.primary),
    secondary: colour(row.secondaryColor, DEFAULT_BRAND.secondary),
    accent: colour(row.accentColor, DEFAULT_BRAND.accent),
    sidebar: colour(row.sidebarColor, DEFAULT_BRAND.sidebar),
    background: colour(row.backgroundColor, DEFAULT_BRAND.background),
    defaultMode: isThemeMode(row.defaultMode) ? row.defaultMode : "system",
  };
}

/**
 * The `<style>` body for this organization, or an empty string on the stock
 * palette.
 *
 * A separate function from `getThemeSettings` because the layout needs only
 * this, and the settings form needs only the values — neither should pay for
 * the other.
 */
export async function getThemeCss(ctx: OrgContext): Promise<string> {
  return buildThemeCss(await getThemeSettings(ctx));
}

/**
 * Replaces the organization's brand.
 *
 * Upsert rather than update: an organization created before Phase 12, or by a
 * path that did not build the nested `theme`, has no row, and failing to save
 * because of that would be a defect the administrator cannot work around.
 *
 * Logs `Theme Changed` — the constant has existed in `ACTIVITY_ACTIONS` since
 * Phase 3 and this is its first emitter. The comment names what changed, so
 * "who made the whole product green" is answerable.
 */
export async function updateThemeSettings(
  ctx: OrgContext,
  input: UpdateThemeInput,
): Promise<void> {
  const current = await getThemeSettings(ctx);

  const changes: string[] = [];
  if (current.preset !== input.preset) changes.push("preset");
  if (current.primary !== input.primaryColor) changes.push("primary");
  if (current.secondary !== input.secondaryColor) changes.push("secondary");
  if (current.accent !== input.accentColor) changes.push("accent");
  if (current.sidebar !== input.sidebarColor) changes.push("sidebar");
  if (current.background !== input.backgroundColor) changes.push("background");
  if (current.defaultMode !== input.defaultMode) changes.push("default mode");

  const organization = await prisma.organization.findFirst({
    where: { id: ctx.organizationId, deletedAt: null },
    select: { logoUrl: true },
  });
  const logoChanged =
    (organization?.logoUrl ?? null) !== (input.logoUrl ?? null);
  if (logoChanged) changes.push("logo");

  if (changes.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.themeSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: {
        organizationId: ctx.organizationId,
        preset: input.preset,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        accentColor: input.accentColor,
        sidebarColor: input.sidebarColor,
        backgroundColor: input.backgroundColor,
        defaultMode: input.defaultMode,
      },
      update: {
        preset: input.preset,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        accentColor: input.accentColor,
        sidebarColor: input.sidebarColor,
        backgroundColor: input.backgroundColor,
        defaultMode: input.defaultMode,
      },
    });

    // The logo lives on Organization, not ThemeSettings — it is identity
    // rather than palette, and Phase 2 already stores and renders it. This
    // screen is simply where it is edited.
    if (logoChanged) {
      await tx.organization.update({
        where: { id: ctx.organizationId },
        data: { logoUrl: input.logoUrl },
      });
    }

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.THEME_CHANGED,
        entityType: EntityType.ORGANIZATION,
        entityId: ctx.organizationId,
        previousValue: current.preset,
        newValue: input.preset,
        comment: `Changed: ${changes.join(", ")}`,
      },
      tx,
    );
  });
}

/** Back to the CoreWorks palette. The logo is identity and is left alone. */
export async function resetThemeSettings(ctx: OrgContext): Promise<void> {
  await updateThemeSettings(ctx, {
    preset: DEFAULT_THEME.preset,
    primaryColor: DEFAULT_THEME.primary,
    secondaryColor: DEFAULT_THEME.secondary,
    accentColor: DEFAULT_THEME.accent,
    sidebarColor: DEFAULT_THEME.sidebar,
    backgroundColor: DEFAULT_THEME.background,
    defaultMode: DEFAULT_THEME.defaultMode,
    logoUrl: await currentLogoUrl(ctx),
  });
}

/** Applies a named preset, keeping the logo and the organization's mode. */
export async function applyThemePreset(
  ctx: OrgContext,
  presetId: string,
): Promise<void> {
  const preset = presetById(presetId);
  if (!preset) return;

  const current = await getThemeSettings(ctx);

  await updateThemeSettings(ctx, {
    preset: preset.id,
    primaryColor: preset.colors.primary,
    secondaryColor: preset.colors.secondary,
    accentColor: preset.colors.accent,
    sidebarColor: preset.colors.sidebar,
    backgroundColor: preset.colors.background,
    defaultMode: current.defaultMode,
    logoUrl: await currentLogoUrl(ctx),
  });
}

async function currentLogoUrl(ctx: OrgContext): Promise<string | null> {
  const organization = await prisma.organization.findFirst({
    where: { id: ctx.organizationId, deletedAt: null },
    select: { logoUrl: true },
  });
  return organization?.logoUrl ?? null;
}

// ---------------------------------------------------------------------------
// The person's own mode
// ---------------------------------------------------------------------------

/**
 * The signed-in user's stored light/dark choice, or null if they have never
 * made one.
 *
 * Stored server-side rather than only in `localStorage` so the choice follows
 * the person between their laptop and their phone. `localStorage` is still
 * written — see `ThemeScript` — because it is what avoids a flash before the
 * server response arrives, but the database is the record.
 */
export async function getUserThemeMode(
  ctx: OrgContext,
): Promise<ThemeMode | null> {
  if (!ctx.userId) return null;

  const row = await prisma.dashboardPreference.findUnique({
    where: {
      userId_dashboard: {
        userId: ctx.userId,
        dashboard: THEME_PREFERENCE_KEY,
      },
    },
    select: { themeMode: true },
  });

  return isThemeMode(row?.themeMode) ? row.themeMode : null;
}

export async function setUserThemeMode(
  ctx: OrgContext,
  mode: ThemeMode,
): Promise<void> {
  const userId = requireUserId(ctx);

  await prisma.dashboardPreference.upsert({
    where: { userId_dashboard: { userId, dashboard: THEME_PREFERENCE_KEY } },
    create: { userId, dashboard: THEME_PREFERENCE_KEY, themeMode: mode },
    update: { themeMode: mode },
  });
}

/**
 * What the page should actually render in: the user's choice if they have one,
 * otherwise the organization default.
 *
 * `DashboardPreference` is keyed on the user alone, not on the organization —
 * light-versus-dark is about the person's eyes and their screen, not about
 * which tenant they are working in, so it deliberately follows them across
 * organizations while the brand does not.
 */
export async function getEffectiveThemeMode(
  ctx: OrgContext,
): Promise<{ mode: ThemeMode; userMode: ThemeMode | null; organizationDefault: ThemeMode }> {
  const [userMode, theme] = await Promise.all([
    getUserThemeMode(ctx),
    getThemeSettings(ctx),
  ]);

  return {
    mode: resolveThemeMode(userMode, theme.defaultMode),
    userMode,
    organizationDefault: theme.defaultMode,
  };
}
