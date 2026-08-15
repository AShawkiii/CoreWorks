import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/domain/enums";
import { slugifyOrganizationName } from "@/lib/validation/bootstrap";
import {
  BootstrapError,
  bootstrapOrganization,
} from "@/server/services/bootstrap";

/**
 * First-organization bootstrap, against a real database.
 *
 * The bootstrap is the one operation with no session behind it and no UI in
 * front of it, so nothing else would catch it going wrong. Two properties
 * matter most and are asserted directly rather than inferred:
 *
 *  - it is **atomic** — a failure leaves nothing behind, because a
 *    half-created tenant is worse than none;
 *  - it **cannot touch an organization it did not create**, which is what
 *    makes it safe to run on a deployment that already has tenants.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-bootstrap-org";
const OTHER_SLUG = "test-bootstrap-incumbent";
const EMAIL_DOMAIN = "@bootstrap-test.example.com";
const PASSWORD = "correct-horse-battery-staple";

const input = (overrides: Partial<Parameters<typeof bootstrapOrganization>[0]> = {}) => ({
  organizationName: "Test Bootstrap Org",
  slug: SLUG,
  ownerName: "Test Owner",
  ownerEmail: `owner${EMAIL_DOMAIN}`,
  ownerPassword: PASSWORD,
  ...overrides,
});

async function cleanup() {
  await prisma.organization.deleteMany({
    where: { slug: { in: [SLUG, OTHER_SLUG] } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.auditLog.deleteMany({
    where: { userEmail: { endsWith: EMAIL_DOMAIN } },
  });
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
});

afterEach(async () => {
  if (!hasDatabase) return;
  await cleanup();
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("bootstrapOrganization", () => {
  it("creates the organization", async () => {
    const result = await bootstrapOrganization(input());

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
      select: { name: true, slug: true, deletedAt: true },
    });
    expect(org.name).toBe("Test Bootstrap Org");
    expect(org.slug).toBe(SLUG);
    expect(org.deletedAt).toBeNull();
  });

  it("seeds every default setting, and marks nothing as demo data", async () => {
    const result = await bootstrapOrganization(input());

    const rows = await prisma.organizationSetting.findMany({
      where: { organizationId: result.organizationId },
      select: { key: true, value: true },
    });

    const keys = Object.keys(DEFAULT_SETTINGS);
    expect(rows.map((r) => r.key).sort()).toEqual([...keys].sort());
    for (const row of rows) {
      expect(row.value).toBe(
        String(DEFAULT_SETTINGS[row.key as keyof typeof DEFAULT_SETTINGS]),
      );
    }

    // The seed's IS_DEMO_DATA marker exists so a production deployment can
    // assert the absence of seeded data. A bootstrapped organization must not
    // carry it, or that check would refuse a legitimate production tenant.
    expect(rows.some((r) => r.key === "IS_DEMO_DATA")).toBe(false);
  });

  it("creates the owner user", async () => {
    const result = await bootstrapOrganization(input());

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.ownerUserId },
      select: { name: true, email: true, deletedAt: true },
    });
    expect(user.name).toBe("Test Owner");
    expect(user.email).toBe(`owner${EMAIL_DOMAIN}`);
    expect(user.deletedAt).toBeNull();
  });

  it("creates an active OWNER membership with an allocated display ID", async () => {
    const result = await bootstrapOrganization(input());

    const member = await prisma.organizationMember.findUniqueOrThrow({
      where: { id: result.ownerMemberId },
      select: {
        role: true,
        isActive: true,
        displayId: true,
        organizationId: true,
        userId: true,
        deletedAt: true,
      },
    });

    expect(member.role).toBe(OrgRole.OWNER);
    expect(member.isActive).toBe(true);
    // Legacy prefix for a member is EMP- (audit §4), not MEMBER-.
    expect(member.displayId).toBe("EMP-001");
    expect(member.organizationId).toBe(result.organizationId);
    expect(member.userId).toBe(result.ownerUserId);
    expect(member.deletedAt).toBeNull();
  });

  it("advances the MEMBER counter, so the next member is not a duplicate", async () => {
    // Hardcoding EMP-001 without touching the sequence would make the
    // application mint EMP-001 again for the first member invited afterwards.
    const result = await bootstrapOrganization(input());

    const sequence = await prisma.idSequence.findUniqueOrThrow({
      where: {
        organizationId_entity: {
          organizationId: result.organizationId,
          entity: "MEMBER",
        },
      },
      select: { lastValue: true },
    });
    expect(sequence.lastValue).toBe(1);
  });

  it("stores a bcrypt hash and never the password itself", async () => {
    const result = await bootstrapOrganization(input());

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.ownerUserId },
      select: { passwordHash: true },
    });

    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    // The hash must actually verify — a stored value that is merely *not* the
    // password would pass the assertion above while locking the owner out.
    expect(await bcrypt.compare(PASSWORD, user.passwordHash!)).toBe(true);
  });

  it("writes no row anywhere containing the plaintext password", async () => {
    const result = await bootstrapOrganization(input());

    // Everything the bootstrap writes, checked as text.
    const [org, user, member, settings, audit] = await Promise.all([
      prisma.organization.findUnique({ where: { id: result.organizationId } }),
      prisma.user.findUnique({ where: { id: result.ownerUserId } }),
      prisma.organizationMember.findUnique({
        where: { id: result.ownerMemberId },
      }),
      prisma.organizationSetting.findMany({
        where: { organizationId: result.organizationId },
      }),
      prisma.auditLog.findMany({
        where: { organizationId: result.organizationId },
      }),
    ]);

    const written = JSON.stringify({ org, user, member, settings, audit });
    expect(written).not.toContain(PASSWORD);
  });

  it("records the creation in the security trail", async () => {
    const result = await bootstrapOrganization(input());

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: {
        organizationId: result.organizationId,
        action: "organization.bootstrapped",
      },
      select: { userId: true, userEmail: true, metadata: true },
    });

    expect(entry.userId).toBe(result.ownerUserId);
    expect(entry.userEmail).toBe(`owner${EMAIL_DOMAIN}`);
    expect(entry.metadata).toMatchObject({ slug: SLUG });
  });

  it("refuses a slug that is already taken, and changes nothing", async () => {
    await bootstrapOrganization(input());

    await expect(
      bootstrapOrganization(
        input({ ownerEmail: `second${EMAIL_DOMAIN}` }),
      ),
    ).rejects.toThrow(BootstrapError);

    // The refused attempt must not have created its user.
    expect(
      await prisma.user.count({
        where: { email: `second${EMAIL_DOMAIN}` },
      }),
    ).toBe(0);
    expect(
      await prisma.organization.count({ where: { slug: SLUG } }),
    ).toBe(1);
  });

  it("refuses an email that already belongs to an account", async () => {
    await bootstrapOrganization(input());

    await expect(
      bootstrapOrganization(input({ slug: OTHER_SLUG })),
    ).rejects.toThrow(/already exists/i);

    // And left no organization behind for the refused attempt.
    expect(
      await prisma.organization.count({ where: { slug: OTHER_SLUG } }),
    ).toBe(0);
  });

  it("rolls back completely when a later step fails", async () => {
    /*
     * The failure is induced at the real membership insert rather than
     * simulated, and induced LATE — after the organization, its settings, its
     * theme row, and the user have all been written inside the same
     * transaction. If atomicity were broken those four would survive.
     *
     * A `NOT VALID` check constraint is the tool: PostgreSQL applies it to new
     * inserts while leaving existing rows unexamined, so every other
     * organization's Owner in this database is undisturbed for the duration.
     */
    const incumbent = await bootstrapOrganization(
      input({ slug: OTHER_SLUG, ownerEmail: `incumbent${EMAIL_DOMAIN}` }),
    );

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OrganizationMember"
       ADD CONSTRAINT "test_bootstrap_no_owner"
       CHECK (role::text <> 'OWNER') NOT VALID`,
    );

    try {
      await expect(bootstrapOrganization(input())).rejects.toThrow();

      // Nothing from the failed attempt survives.
      expect(
        await prisma.organization.count({ where: { slug: SLUG } }),
      ).toBe(0);
      expect(
        await prisma.user.count({ where: { email: `owner${EMAIL_DOMAIN}` } }),
      ).toBe(0);
      expect(
        await prisma.organizationSetting.count({
          where: { organization: { slug: SLUG } },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { userEmail: `owner${EMAIL_DOMAIN}` },
        }),
      ).toBe(0);

      // And the incumbent organization is untouched.
      expect(
        await prisma.organizationMember.count({
          where: { organizationId: incumbent.organizationId },
        }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "OrganizationMember"
         DROP CONSTRAINT IF EXISTS "test_bootstrap_no_owner"`,
      );
    }
  });

  it("leaves an existing organization completely untouched", async () => {
    // The safety property that makes this runnable on a live deployment.
    const incumbent = await bootstrapOrganization(
      input({
        organizationName: "Incumbent",
        slug: OTHER_SLUG,
        ownerEmail: `incumbent${EMAIL_DOMAIN}`,
      }),
    );

    const before = {
      org: await prisma.organization.findUniqueOrThrow({
        where: { id: incumbent.organizationId },
      }),
      members: await prisma.organizationMember.count({
        where: { organizationId: incumbent.organizationId },
      }),
      settings: await prisma.organizationSetting.count({
        where: { organizationId: incumbent.organizationId },
      }),
    };

    await bootstrapOrganization(input());

    expect(
      await prisma.organization.findUniqueOrThrow({
        where: { id: incumbent.organizationId },
      }),
    ).toEqual(before.org);
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: incumbent.organizationId },
      }),
    ).toBe(before.members);
    expect(
      await prisma.organizationSetting.count({
        where: { organizationId: incumbent.organizationId },
      }),
    ).toBe(before.settings);
  });

  it("creates nothing outside the organization it is creating", async () => {
    const incumbent = await bootstrapOrganization(
      input({ slug: OTHER_SLUG, ownerEmail: `incumbent${EMAIL_DOMAIN}` }),
    );
    const result = await bootstrapOrganization(input());

    // Every row the new bootstrap wrote carries the new organization's id —
    // no membership, setting, sequence, or audit entry landed in the other.
    for (const [label, count] of [
      [
        "members",
        await prisma.organizationMember.count({
          where: { organizationId: incumbent.organizationId, deletedAt: null },
        }),
      ],
      [
        "sequences",
        await prisma.idSequence.count({
          where: { organizationId: incumbent.organizationId },
        }),
      ],
    ] as const) {
      expect(count, `${label} in the incumbent organization`).toBe(1);
    }

    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: incumbent.organizationId,
          action: "organization.bootstrapped",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: result.organizationId,
          action: "organization.bootstrapped",
        },
      }),
    ).toBe(1);
  });
});

suite("bootstrapOrganization input validation", () => {
  const cases: [string, Parameters<typeof bootstrapOrganization>[0], RegExp][] =
    [
      [
        "a password below the application's 12-character floor",
        input({ ownerPassword: "short" }),
        /at least 12 characters/i,
      ],
      [
        "a malformed email",
        input({ ownerEmail: "not-an-address" }),
        /valid email/i,
      ],
      [
        "an empty organization name",
        input({ organizationName: "" }),
        /at least 2 characters/i,
      ],
      [
        "a one-character owner name",
        input({ ownerName: "A" }),
        /at least 2 characters/i,
      ],
      [
        "a slug that would shadow an application route",
        input({ slug: "settings" }),
        /reserved/i,
      ],
      [
        "a slug with illegal characters",
        input({ slug: "Not A Slug" }),
        /lowercase letters/i,
      ],
    ];

  for (const [label, bad, message] of cases) {
    it(`rejects ${label}`, async () => {
      await expect(bootstrapOrganization(bad)).rejects.toThrow(message);
    });
  }

  it("writes nothing at all when input is invalid", async () => {
    await expect(
      bootstrapOrganization(input({ ownerPassword: "short" })),
    ).rejects.toThrow(BootstrapError);

    expect(await prisma.organization.count({ where: { slug: SLUG } })).toBe(0);
    expect(
      await prisma.user.count({ where: { email: `owner${EMAIL_DOMAIN}` } }),
    ).toBe(0);
  });

  it("normalises the owner email, so case cannot create a second account", async () => {
    const result = await bootstrapOrganization(
      input({ ownerEmail: `Owner${EMAIL_DOMAIN}`.toUpperCase() }),
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.ownerUserId },
      select: { email: true },
    });
    expect(user.email).toBe(`owner${EMAIL_DOMAIN}`);
  });
});

describe("slugifyOrganizationName", () => {
  it("derives a usable slug from an ordinary name", () => {
    expect(slugifyOrganizationName("Meridian Advisory")).toBe(
      "meridian-advisory",
    );
    expect(slugifyOrganizationName("Smith & Co.")).toBe("smith-co");
  });

  it("folds accents rather than dropping the letters", () => {
    // "Ångström" must not become "ngstrm".
    expect(slugifyOrganizationName("Ångström Partners")).toBe(
      "angstrom-partners",
    );
  });

  it("collapses and trims separators", () => {
    expect(slugifyOrganizationName("  --Acme---Group--  ")).toBe("acme-group");
  });

  it("returns an empty string it cannot make a slug from", () => {
    // The caller validates the result, so this reports failure rather than
    // inventing a name nobody chose.
    expect(slugifyOrganizationName("株式会社")).toBe("");
  });
});
