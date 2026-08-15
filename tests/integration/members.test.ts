import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  inviteMember,
  listMembers,
  MemberOperationError,
  setMemberActive,
  updateMember,
} from "@/server/services/members";
import { nextDisplayId } from "@/server/services/ids";
import { ForbiddenError, type OrgContext } from "@/server/context";

/**
 * Integration tests against a real PostgreSQL database.
 *
 * These cover the two things unit tests cannot: that tenant isolation holds
 * at the query level (master prompt §48), and that the member-management
 * guards actually refuse — the RBAC matrix being correct in isolation does
 * not prove the services consult it.
 *
 * Skipped when DATABASE_URL is unset, so `npm test` still runs without a
 * database available.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG_A = "test-org-alpha";
const SLUG_B = "test-org-beta";

interface Fixture {
  ctxOwner: OrgContext;
  ctxManager: OrgContext;
  ctxOtherOrgOwner: OrgContext;
  ownerMemberId: string;
  managerMemberId: string;
  otherOrgMemberId: string;
  organizationAId: string;
}

let fx: Fixture;

async function makeOrg(slug: string, name: string) {
  return prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
}

async function makeMember(
  organizationId: string,
  email: string,
  name: string,
  role: OrgRole,
  sequence: number,
) {
  const user = await prisma.user.create({
    data: { name, email, passwordHash: "not-used-in-these-tests" },
    select: { id: true, email: true, name: true },
  });

  const member = await prisma.organizationMember.create({
    data: {
      organizationId,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", sequence),
      role,
      isActive: true,
    },
    select: { id: true },
  });

  return { user, memberId: member.id };
}

function contextFor(
  organizationId: string,
  organizationSlug: string,
  user: { id: string; email: string; name: string },
  membershipId: string,
  role: OrgRole,
): OrgContext {
  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId,
    organizationSlug,
    membershipId,
    role,
  };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG_A, SLUG_B] } },
    select: { id: true },
  });

  if (orgs.length > 0) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: { in: orgs.map((o) => o.id) } },
      select: { userId: true },
    });

    // Members cascade with the organization; the shared User rows do not.
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: members.map((m) => m.userId) } },
    });
  }

  await prisma.user.deleteMany({
    where: { email: { endsWith: "@tenancy-test.example.com" } },
  });
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const orgA = await makeOrg(SLUG_A, "Alpha Advisory");
  const orgB = await makeOrg(SLUG_B, "Beta Partners");

  const owner = await makeMember(
    orgA.id,
    "owner@tenancy-test.example.com",
    "Alpha Owner",
    OrgRole.OWNER,
    1,
  );
  const manager = await makeMember(
    orgA.id,
    "manager@tenancy-test.example.com",
    "Alpha Manager",
    OrgRole.MANAGER,
    2,
  );
  const otherOwner = await makeMember(
    orgB.id,
    "beta-owner@tenancy-test.example.com",
    "Beta Owner",
    OrgRole.OWNER,
    1,
  );

  await prisma.idSequence.createMany({
    data: [
      { organizationId: orgA.id, entity: "MEMBER", lastValue: 2 },
      { organizationId: orgB.id, entity: "MEMBER", lastValue: 1 },
    ],
  });

  fx = {
    organizationAId: orgA.id,
    ctxOwner: contextFor(orgA.id, orgA.slug, owner.user, owner.memberId, OrgRole.OWNER),
    ctxManager: contextFor(
      orgA.id,
      orgA.slug,
      manager.user,
      manager.memberId,
      OrgRole.MANAGER,
    ),
    ctxOtherOrgOwner: contextFor(
      orgB.id,
      orgB.slug,
      otherOwner.user,
      otherOwner.memberId,
      OrgRole.OWNER,
    ),
    ownerMemberId: owner.memberId,
    managerMemberId: manager.memberId,
    otherOrgMemberId: otherOwner.memberId,
  };
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("tenant isolation", () => {
  it("lists only the caller's own organization members", async () => {
    const alpha = await listMembers(fx.ctxOwner);
    const beta = await listMembers(fx.ctxOtherOrgOwner);

    expect(alpha.map((m) => m.email).sort()).toEqual([
      "manager@tenancy-test.example.com",
      "owner@tenancy-test.example.com",
    ]);
    expect(beta.map((m) => m.email)).toEqual([
      "beta-owner@tenancy-test.example.com",
    ]);
  });

  it("refuses to update a member belonging to another organization", async () => {
    // The id is real and the caller is an Owner — but of a different
    // organization. Without org scoping this would succeed.
    await expect(
      updateMember(fx.ctxOwner, {
        memberId: fx.otherOrgMemberId,
        name: "Hijacked",
        role: OrgRole.VIEWER,
        jobTitle: null,
        department: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.organizationMember.findUnique({
      where: { id: fx.otherOrgMemberId },
      select: { role: true, user: { select: { name: true } } },
    });
    expect(untouched?.role).toBe(OrgRole.OWNER);
    expect(untouched?.user.name).toBe("Beta Owner");
  });

  it("refuses to deactivate a member in another organization", async () => {
    await expect(
      setMemberActive(fx.ctxOwner, fx.otherOrgMemberId, false),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const still = await prisma.organizationMember.findUnique({
      where: { id: fx.otherOrgMemberId },
      select: { isActive: true },
    });
    expect(still?.isActive).toBe(true);
  });

  it("scopes display-ID sequences per organization", async () => {
    // Both organizations must be able to hold EMP-003 independently.
    const a = await nextDisplayId(fx.organizationAId, "MEMBER");
    const b = await nextDisplayId(fx.ctxOtherOrgOwner.organizationId, "MEMBER");

    expect(a).toBe("EMP-003");
    expect(b).toBe("EMP-002");
  });
});

suite("member management guards", () => {
  it("stops a Manager assigning a role at or above their own", async () => {
    await expect(
      inviteMember(fx.ctxManager, {
        name: "Escalation Attempt",
        email: "escalate@tenancy-test.example.com",
        password: "a-long-enough-password",
        role: OrgRole.OWNER,
        jobTitle: null,
        department: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await prisma.user.findUnique({
      where: { email: "escalate@tenancy-test.example.com" },
      select: { id: true },
    });
    expect(created).toBeNull();
  });

  it("stops a Manager promoting anyone to Owner", async () => {
    const { memberId } = await inviteMember(fx.ctxManager, {
      name: "Junior Staff",
      email: "junior@tenancy-test.example.com",
      password: "a-long-enough-password",
      role: OrgRole.TEAM_MEMBER,
      jobTitle: "Bookkeeper",
      department: null,
      capacity: 0,
    });

    await expect(
      updateMember(fx.ctxManager, {
        memberId,
        name: "Junior Staff",
        role: OrgRole.OWNER,
        jobTitle: "Bookkeeper",
        department: null,
        capacity: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("persists a capacity of zero rather than treating it as unset", async () => {
    const member = await prisma.organizationMember.findFirst({
      where: {
        organizationId: fx.organizationAId,
        user: { email: "junior@tenancy-test.example.com" },
      },
      select: { capacity: true },
    });
    expect(member?.capacity).toBe(0);
  });

  it("rejects a duplicate email within the organization", async () => {
    await expect(
      inviteMember(fx.ctxOwner, {
        name: "Duplicate",
        email: "junior@tenancy-test.example.com",
        password: "a-long-enough-password",
        role: OrgRole.VIEWER,
        jobTitle: null,
        department: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(MemberOperationError);
  });

  it("stops a Manager managing a member senior to them", async () => {
    await expect(
      setMemberActive(fx.ctxManager, fx.ownerMemberId, false),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stops a user changing their own active status", async () => {
    // Sign-in requires an active membership, so self-deactivation would be
    // an immediate, irreversible self-lockout.
    await expect(
      setMemberActive(fx.ctxOwner, fx.ownerMemberId, false),
    ).rejects.toBeInstanceOf(MemberOperationError);
  });

  it("stops the last active Owner being demoted", async () => {
    await expect(
      updateMember(fx.ctxOwner, {
        memberId: fx.ownerMemberId,
        name: "Alpha Owner",
        role: OrgRole.ADMIN,
        jobTitle: null,
        department: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(MemberOperationError);
  });

  it("allows demoting an Owner once a second Owner exists", async () => {
    const { memberId: secondOwnerId } = await inviteMember(fx.ctxOwner, {
      name: "Second Owner",
      email: "second-owner@tenancy-test.example.com",
      password: "a-long-enough-password",
      role: OrgRole.OWNER,
      jobTitle: null,
      department: null,
      capacity: null,
    });

    await expect(
      updateMember(fx.ctxOwner, {
        memberId: secondOwnerId,
        name: "Second Owner",
        role: OrgRole.ADMIN,
        jobTitle: null,
        department: null,
        capacity: null,
      }),
    ).resolves.toBeUndefined();

    const demoted = await prisma.organizationMember.findUnique({
      where: { id: secondOwnerId },
      select: { role: true },
    });
    expect(demoted?.role).toBe(OrgRole.ADMIN);
  });

  it("writes an activity log entry for member changes", async () => {
    const entries = await prisma.activityLog.findMany({
      where: { organizationId: fx.organizationAId },
      select: { action: true, displayId: true },
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.action)).toContain("Member Added");
    // Legacy ACT- format, allocated per organization.
    for (const entry of entries) {
      expect(entry.displayId).toMatch(/^ACT-\d{7}$/);
    }
  });
});

suite("id sequence concurrency", () => {
  it("never issues the same id twice under parallel allocation", async () => {
    // The legacy scan-max-and-increment generator fails exactly here
    // (audit defect D3): concurrent callers read the same maximum.
    const ids = await Promise.all(
      Array.from({ length: 25 }, () =>
        nextDisplayId(fx.organizationAId, "TASK"),
      ),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
