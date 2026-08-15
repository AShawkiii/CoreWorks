import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { forgotPasswordAction } from "@/app/(auth)/forgot-password/actions";
import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  auditActionLabel,
  isSecurityConcern,
} from "@/lib/domain/audit-actions";
import { PASSWORD_RESET_RULE, SIGN_IN_RULE } from "@/lib/domain/rate-limit";
import type { OrgContext } from "@/server/context";
import { logAudit } from "@/server/services/activity";
import { listAuditLog } from "@/server/services/audit-queries";
import {
  clearRateLimit,
  consumeRateLimit,
  pruneRateLimits,
} from "@/server/services/rate-limit";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 14 integration tests — rate limiting and the audit trail.
 *
 * Both close gaps `security.md` named explicitly, and both are the kind of
 * control that is easy to write and easy to have quietly not work: a limiter
 * whose counter never persists, or a trail that silently drops the rows an
 * investigator needs.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-security";
const RIVAL_SLUG = "test-org-security-rival";
const EMAIL_DOMAIN = "@security-test.example.com";
const KEY_PREFIX = "test-scope";

let ctx: OrgContext;
let rivalCtx: OrgContext;

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, RIVAL_SLUG] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.auditLog.deleteMany({
    where: { userEmail: { endsWith: EMAIL_DOMAIN } },
  });
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: KEY_PREFIX } },
        { key: { endsWith: EMAIL_DOMAIN } },
      ],
    },
  });
}

async function buildOrg(slug: string, name: string, prefix: string) {
  const org = await prisma.organization.create({
    data: { name, slug },
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

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
    role: OrgRole.OWNER,
  } satisfies OrgContext;
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  ctx = await buildOrg(SLUG, "Security Test Org", "primary");
  rivalCtx = await buildOrg(RIVAL_SLUG, "Rival Org", "rival");
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!hasDatabase) return;
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: KEY_PREFIX } },
        { key: { endsWith: EMAIL_DOMAIN } },
      ],
    },
  });
  await prisma.passwordResetToken.deleteMany({
    where: { user: { email: { endsWith: EMAIL_DOMAIN } } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { organizationId: { in: [ctx.organizationId, rivalCtx.organizationId] } },
        { userEmail: { endsWith: EMAIL_DOMAIN } },
      ],
    },
  });
});

const T0 = new Date("2026-08-15T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

suite("rate limiting against the real store", () => {
  const RULE = { limit: 3, windowMs: 60_000 };

  it("persists the counter across calls", async () => {
    const subject = `persist${EMAIL_DOMAIN}`;

    const outcomes: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await consumeRateLimit(
        KEY_PREFIX,
        subject,
        RULE,
        at(i * 1000),
      );
      outcomes.push(result.allowed);
    }

    expect(outcomes).toEqual([true, true, true, false, false]);

    // The row genuinely exists — a limiter that only counted in memory would
    // give an attacker one budget per process.
    const stored = await prisma.rateLimit.findUniqueOrThrow({
      where: { key: `${KEY_PREFIX}:${subject.toLowerCase()}` },
      select: { count: true },
    });
    expect(stored.count).toBe(5);
  });

  it("keeps separate budgets per subject", async () => {
    await consumeRateLimit(KEY_PREFIX, `a${EMAIL_DOMAIN}`, RULE, T0);
    await consumeRateLimit(KEY_PREFIX, `a${EMAIL_DOMAIN}`, RULE, T0);
    await consumeRateLimit(KEY_PREFIX, `a${EMAIL_DOMAIN}`, RULE, T0);

    // One subject exhausted; another must be untouched.
    expect(
      (await consumeRateLimit(KEY_PREFIX, `a${EMAIL_DOMAIN}`, RULE, T0)).allowed,
    ).toBe(false);
    expect(
      (await consumeRateLimit(KEY_PREFIX, `b${EMAIL_DOMAIN}`, RULE, T0)).allowed,
    ).toBe(true);
  });

  it("shares one budget across capitalisations of the same address", async () => {
    // Otherwise varying the case resets the counter and the limit is useless.
    const lower = `case${EMAIL_DOMAIN}`;
    const upper = `CASE${EMAIL_DOMAIN.toUpperCase()}`;

    for (let i = 0; i < 3; i += 1) {
      await consumeRateLimit(KEY_PREFIX, lower, RULE, T0);
    }

    expect((await consumeRateLimit(KEY_PREFIX, upper, RULE, T0)).allowed).toBe(
      false,
    );
  });

  it("opens a new window after the old one elapses", async () => {
    const subject = `window${EMAIL_DOMAIN}`;
    for (let i = 0; i < 4; i += 1) {
      await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);
    }
    expect(
      (await consumeRateLimit(KEY_PREFIX, subject, RULE, T0)).allowed,
    ).toBe(false);

    const later = await consumeRateLimit(
      KEY_PREFIX,
      subject,
      RULE,
      at(RULE.windowMs),
    );
    expect(later.allowed).toBe(true);
  });

  it("clears on success, so a mistyped password is not carried forward", async () => {
    const subject = `clear${EMAIL_DOMAIN}`;
    await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);
    await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);

    await clearRateLimit(KEY_PREFIX, subject);

    const fresh = await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);
    expect(fresh.remaining).toBe(RULE.limit - 1);
  });

  it("reports a Retry-After of at least one second", async () => {
    const subject = `retry${EMAIL_DOMAIN}`;
    for (let i = 0; i < 4; i += 1) {
      await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);
    }
    const refused = await consumeRateLimit(KEY_PREFIX, subject, RULE, T0);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("prunes only rows whose window closed", async () => {
    await consumeRateLimit(KEY_PREFIX, `old${EMAIL_DOMAIN}`, RULE, T0);
    await consumeRateLimit(
      KEY_PREFIX,
      `new${EMAIL_DOMAIN}`,
      RULE,
      at(10 * 60_000),
    );

    const removed = await pruneRateLimits(at(5 * 60_000));

    expect(removed).toBe(1);
    expect(
      await prisma.rateLimit.count({ where: { key: { startsWith: KEY_PREFIX } } }),
    ).toBe(1);
  });

  it("is safe to prune twice", async () => {
    await consumeRateLimit(KEY_PREFIX, `p${EMAIL_DOMAIN}`, RULE, T0);
    await pruneRateLimits(at(60 * 60_000));
    const second = await pruneRateLimits(at(60 * 60_000));
    expect(second).toBe(0);
  });

  it("holds the real sign-in rule end to end", async () => {
    const subject = `signin${EMAIL_DOMAIN}`;

    for (let i = 0; i < SIGN_IN_RULE.limit; i += 1) {
      const result = await consumeRateLimit(
        KEY_PREFIX,
        subject,
        SIGN_IN_RULE,
        at(i * 1000),
      );
      expect(result.allowed, `attempt ${i + 1}`).toBe(true);
    }

    const refused = await consumeRateLimit(
      KEY_PREFIX,
      subject,
      SIGN_IN_RULE,
      at(SIGN_IN_RULE.limit * 1000),
    );
    expect(refused.allowed).toBe(false);
  });
});

suite("the audit trail", () => {
  it("records an entry with no organization at all", async () => {
    // A sign-in attempt against an unknown address belongs to no tenant. This
    // is why AuditLog.organizationId is nullable and ActivityLog's is not.
    await logAudit({
      userEmail: `ghost${EMAIL_DOMAIN}`,
      action: "sign_in.unknown_or_disabled",
    });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { userEmail: `ghost${EMAIL_DOMAIN}` },
      select: { organizationId: true, action: true },
    });
    expect(entry.organizationId).toBeNull();
  });

  it("shows an administrator both their own and unattributed entries", async () => {
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: ctx.userEmail,
      action: "data.export",
    });
    await logAudit({
      userEmail: `ghost${EMAIL_DOMAIN}`,
      action: "sign_in.bad_password",
    });

    const result = await listAuditLog(ctx, { page: 1 });
    const actions = result.rows.map((row) => row.action);

    expect(actions).toContain("data.export");
    // The unattributed row is the one an investigator actually needs.
    expect(actions).toContain("sign_in.bad_password");
    expect(
      result.rows.find((row) => row.action === "sign_in.bad_password")
        ?.unattributed,
    ).toBe(true);
  });

  it("never shows another organization's attributed entries", async () => {
    await logAudit({
      organizationId: rivalCtx.organizationId,
      userEmail: rivalCtx.userEmail,
      action: "data.export",
    });

    const mine = await listAuditLog(ctx, { page: 1 });
    expect(
      mine.rows.some((row) => row.userEmail === rivalCtx.userEmail),
    ).toBe(false);

    // And the reverse.
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: ctx.userEmail,
      action: "data.import",
    });
    const theirs = await listAuditLog(rivalCtx, { page: 1 });
    expect(theirs.rows.some((row) => row.action === "data.import")).toBe(false);
  });

  it("counts recent failed sign-ins but not successes", async () => {
    // Measured as a DELTA, not an absolute. `recentFailures` deliberately
    // includes unattributed entries from anywhere in the deployment, so any
    // other failed sign-in in the last 24 hours — a colleague mistyping, a
    // live verification run — is legitimately in the baseline. Asserting an
    // absolute would make this test a report on the database's history.
    const before = (await listAuditLog(ctx, { page: 1 })).recentFailures;

    await logAudit({ userEmail: `a${EMAIL_DOMAIN}`, action: "sign_in.bad_password" });
    await logAudit({ userEmail: `b${EMAIL_DOMAIN}`, action: "sign_in.rate_limited" });
    await logAudit({ userEmail: `c${EMAIL_DOMAIN}`, action: "sign_in.success" });
    await logAudit({ userEmail: `d${EMAIL_DOMAIN}`, action: "data.export" });

    const after = (await listAuditLog(ctx, { page: 1 })).recentFailures;
    expect(after - before).toBe(2);
  });

  it("filters by action and searches by address", async () => {
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: `findme${EMAIL_DOMAIN}`,
      action: "data.export",
    });
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: `other${EMAIL_DOMAIN}`,
      action: "data.import",
    });

    const byAction = await listAuditLog(ctx, { page: 1, action: "data.export" });
    expect(byAction.rows.every((row) => row.action === "data.export")).toBe(true);

    const bySearch = await listAuditLog(ctx, { page: 1, q: "findme" });
    expect(bySearch.rows).toHaveLength(1);
    expect(bySearch.rows[0]?.userEmail).toContain("findme");
  });

  it("offers the actions present in the data", async () => {
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: ctx.userEmail,
      action: "data.export",
    });

    const result = await listAuditLog(ctx, { page: 1 });
    expect(result.actions).toContain("data.export");
    expect(new Set(result.actions).size).toBe(result.actions.length);
  });

  it("returns newest first", async () => {
    for (const action of ["sign_in.success", "data.export", "data.import"]) {
      await logAudit({
        organizationId: ctx.organizationId,
        userEmail: ctx.userEmail,
        action,
      });
    }

    const result = await listAuditLog(ctx, { page: 1 });
    for (let i = 1; i < result.rows.length; i += 1) {
      expect(result.rows[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        result.rows[i]!.createdAt.getTime(),
      );
    }
  });

  it("stores metadata without it reaching the row shape", async () => {
    await logAudit({
      organizationId: ctx.organizationId,
      userEmail: ctx.userEmail,
      action: "data.export",
      metadata: { sheet: "CLIENTS", rows: 10 },
    });

    const raw = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, action: "data.export" },
      select: { metadata: true },
    });
    expect(raw.metadata).toMatchObject({ sheet: "CLIENTS", rows: 10 });
  });
});

suite("the password-reset request", () => {
  /** `OrgContext.userId` is nullable for scheduled runs; a fixture has one. */
  const ownerId = () => ctx.userId as string;

  /** The action reads `email` off a FormData, as the form submits it. */
  const submit = (email: string) => {
    const data = new FormData();
    data.set("email", email);
    return forgotPasswordAction({}, data);
  };

  it("issues a token for a real account", async () => {
    const state = await submit(ctx.userEmail);

    expect(state.sent).toBe(true);
    const tokens = await prisma.passwordResetToken.count({
      where: { userId: ownerId() },
    });
    expect(tokens).toBe(1);
  });

  it("supersedes an outstanding token rather than issuing a second", async () => {
    await submit(ctx.userEmail);
    const first = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: ownerId() },
      select: { tokenHash: true },
    });

    await submit(ctx.userEmail);
    const after = await prisma.passwordResetToken.findMany({
      where: { userId: ownerId() },
      select: { tokenHash: true },
    });

    expect(after).toHaveLength(1);
    expect(after[0]!.tokenHash).not.toBe(first.tokenHash);
  });

  it("stores only a hash, never the token itself", async () => {
    await submit(ctx.userEmail);
    const row = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: ownerId() },
      select: { tokenHash: true },
    });

    // SHA-256 hex. A base64url token would be 43 characters and contain
    // characters outside [0-9a-f].
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers an unknown address exactly as it answers a real one", async () => {
    // The response is the whole defence against enumeration, so it is asserted
    // as a whole rather than field by field.
    const real = await submit(ctx.userEmail);
    await prisma.rateLimit.deleteMany({
      where: { key: { endsWith: EMAIL_DOMAIN } },
    });
    const absent = await submit(`nobody-at-all${EMAIL_DOMAIN}`);

    expect(absent).toEqual(real);
    expect(absent).toEqual({ sent: true });
  });

  it("refuses past the limit, and counts absent addresses too", async () => {
    // Counting only real addresses would make the counter itself the oracle
    // the uniform response exists to prevent.
    const absent = `ghost${EMAIL_DOMAIN}`;
    const outcomes: boolean[] = [];
    for (let i = 0; i < PASSWORD_RESET_RULE.limit + 1; i += 1) {
      outcomes.push(Boolean((await submit(absent)).sent));
    }

    expect(outcomes.filter(Boolean)).toHaveLength(PASSWORD_RESET_RULE.limit);
    expect(outcomes.at(-1)).toBe(false);

    const stored = await prisma.rateLimit.findUniqueOrThrow({
      where: { key: `reset:${absent.toLowerCase()}` },
      select: { count: true },
    });
    expect(stored.count).toBe(PASSWORD_RESET_RULE.limit + 1);
  });

  it("tells the caller how long to wait, without pretending it sent mail", async () => {
    for (let i = 0; i < PASSWORD_RESET_RULE.limit; i += 1) {
      await submit(ctx.userEmail);
    }
    const refused = await submit(ctx.userEmail);

    expect(refused.sent).toBeUndefined();
    expect(refused.retryAfterMinutes).toBeGreaterThan(0);
    expect(refused.retryAfterMinutes).toBeLessThanOrEqual(
      PASSWORD_RESET_RULE.windowMs / 60_000,
    );
  });

  it("issues nothing once refused", async () => {
    for (let i = 0; i < PASSWORD_RESET_RULE.limit; i += 1) {
      await submit(ctx.userEmail);
    }
    const before = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: ownerId() },
      select: { tokenHash: true },
    });

    await submit(ctx.userEmail);

    const after = await prisma.passwordResetToken.findMany({
      where: { userId: ownerId() },
      select: { tokenHash: true },
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.tokenHash).toBe(before.tokenHash);
  });

  it("shares one budget across capitalisations", async () => {
    const address = ctx.userEmail;
    for (let i = 0; i < PASSWORD_RESET_RULE.limit; i += 1) {
      await submit(address);
    }

    expect((await submit(address.toUpperCase())).sent).toBeUndefined();
  });

  it("attributes a known address to its organization", async () => {
    // An unattributed entry is shown to EVERY administrator in the
    // deployment. Leaving one null when the account is known would put a
    // member's reset requests in front of every other organization's admins.
    await submit(ctx.userEmail);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "password_reset.requested", userEmail: ctx.userEmail },
      select: { organizationId: true, userId: true },
    });
    expect(entry.organizationId).toBe(ctx.organizationId);
    expect(entry.userId).toBe(ownerId());
  });

  it("leaves an unknown address unattributed, since it cannot be placed", async () => {
    await submit(`ghost${EMAIL_DOMAIN}`);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "password_reset.requested",
        userEmail: `ghost${EMAIL_DOMAIN}`,
      },
      select: { organizationId: true, userId: true },
    });
    expect(entry.organizationId).toBeNull();
    expect(entry.userId).toBeNull();
  });

  it("records both the request and the refusal", async () => {
    for (let i = 0; i < PASSWORD_RESET_RULE.limit + 1; i += 1) {
      await submit(ctx.userEmail);
    }

    const entries = await prisma.auditLog.groupBy({
      by: ["action"],
      where: { userEmail: ctx.userEmail.toLowerCase() },
      _count: { action: true },
    });
    const counts = Object.fromEntries(
      entries.map((row) => [row.action, row._count.action]),
    );

    expect(counts["password_reset.requested"]).toBe(PASSWORD_RESET_RULE.limit);
    expect(counts["password_reset.rate_limited"]).toBe(1);
  });

  it("rejects a malformed address before spending any budget", async () => {
    const state = await submit("not-an-address");

    expect(state.fieldErrors?.email).toBeTruthy();
    expect(state.sent).toBeUndefined();
    const rows = await prisma.rateLimit.count({
      where: { key: { startsWith: "reset:not-an-address" } },
    });
    expect(rows).toBe(0);
  });

  it("issues nothing for a deleted account, but still answers the same", async () => {
    const deleted = await prisma.user.create({
      data: {
        name: "Departed",
        email: `departed${EMAIL_DOMAIN}`,
        passwordHash: "unused",
        deletedAt: new Date(),
      },
      select: { id: true, email: true },
    });

    const state = await submit(deleted.email!);

    expect(state).toEqual({ sent: true });
    expect(
      await prisma.passwordResetToken.count({ where: { userId: deleted.id } }),
    ).toBe(0);

    await prisma.user.delete({ where: { id: deleted.id } });
  });
});

describe("audit labelling", () => {
  it("labels the actions this codebase writes", () => {
    expect(auditActionLabel("sign_in.success")).toBe("Signed in");
    expect(auditActionLabel("sign_in.rate_limited")).toBe(
      "Blocked — too many attempts",
    );
    expect(auditActionLabel("data.export")).toBe("Exported data");
  });

  it("shows an unknown code rather than hiding it", () => {
    // A reader that hides what it cannot label is worse than one showing a
    // machine-readable value.
    expect(auditActionLabel("something.new")).toBe("something.new");
  });

  it("flags every failed sign-in and no success", () => {
    expect(isSecurityConcern("sign_in.bad_password")).toBe(true);
    expect(isSecurityConcern("sign_in.rate_limited")).toBe(true);
    expect(isSecurityConcern("sign_in.unknown_or_disabled")).toBe(true);
    expect(isSecurityConcern("sign_in.success")).toBe(false);
    expect(isSecurityConcern("data.export")).toBe(false);
  });

  it("flags a refused reset but not an ordinary one", () => {
    // People forget passwords; that is not an incident. Enough requests to
    // hit the limit is.
    expect(isSecurityConcern("password_reset.requested")).toBe(false);
    expect(isSecurityConcern("password_reset.rate_limited")).toBe(true);
    expect(auditActionLabel("password_reset.requested")).toBe(
      "Requested a password reset",
    );
  });
});
