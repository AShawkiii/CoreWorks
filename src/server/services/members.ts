import bcrypt from "bcryptjs";

import { EntityType, OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type {
  InviteMemberInput,
  UpdateMemberInput,
} from "@/lib/validation/member";
import { canManageRole } from "@/server/auth/permissions";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { nextDisplayId } from "@/server/services/ids";
import { ForbiddenError, type OrgContext } from "@/server/context";

/**
 * Organization member management.
 *
 * Every guard here is enforced server-side. The UI hides actions a user
 * cannot take, but hiding is not preventing — these functions are what
 * actually refuse (master prompt §9/§35).
 */

/** Raised for a rule violation the user can fix, e.g. a duplicate email. */
export class MemberOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberOperationError";
  }
}

const BCRYPT_ROUNDS = 12;

export interface MemberListItem {
  id: string;
  displayId: string;
  name: string;
  email: string;
  role: OrgRole;
  jobTitle: string | null;
  department: string | null;
  capacity: number | null;
  isActive: boolean;
  isSelf: boolean;
  /** Whether the viewing user may edit this member — drives the UI, mirrors the server guard. */
  canManage: boolean;
}

export async function listMembers(ctx: OrgContext): Promise<MemberListItem[]> {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      displayId: true,
      role: true,
      jobTitle: true,
      department: true,
      capacity: true,
      isActive: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  });

  return members.map((member) => ({
    id: member.id,
    displayId: member.displayId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    jobTitle: member.jobTitle,
    department: member.department,
    capacity: member.capacity,
    isActive: member.isActive,
    isSelf: member.userId === ctx.userId,
    canManage: canManageRole(ctx.role, member.role),
  }));
}

/** Loads a member, guaranteeing it belongs to the caller's organization. */
async function requireMemberInOrg(ctx: OrgContext, memberId: string) {
  const member = await prisma.organizationMember.findFirst({
    where: {
      id: memberId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: {
      id: true,
      role: true,
      isActive: true,
      userId: true,
      organizationId: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!member) {
    // Same message whether the member is absent or belongs to another
    // organization — a distinct "wrong organization" error would confirm
    // that the id exists elsewhere.
    throw new ForbiddenError("Member not found in this organization.");
  }

  return member;
}

/** Counts active Owners, used to stop the last one being removed or demoted. */
async function countActiveOwners(organizationId: string): Promise<number> {
  return prisma.organizationMember.count({
    where: {
      organizationId,
      role: OrgRole.OWNER,
      isActive: true,
      deletedAt: null,
    },
  });
}

export async function inviteMember(
  ctx: OrgContext,
  input: InviteMemberInput,
): Promise<{ memberId: string }> {
  // A user may not create a member at or above their own level — otherwise
  // any Manager could mint an Owner and escalate.
  if (!canManageRole(ctx.role, input.role)) {
    throw new ForbiddenError(
      "You cannot assign a role at or above your own level.",
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, deletedAt: true },
  });

  if (existingUser) {
    const existingMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: existingUser.id,
        },
      },
      select: { id: true },
    });

    if (existingMembership) {
      throw new MemberOperationError(
        "That email already belongs to a member of this organization.",
      );
    }
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const memberId = await prisma.$transaction(async (tx) => {
    // An existing CoreWorks user joining a second organization keeps their
    // identity and password; only a brand-new user gets one created.
    const user = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: { deletedAt: null },
          select: { id: true },
        })
      : await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash,
          },
          select: { id: true },
        });

    const displayId = await nextDisplayId(ctx.organizationId, "MEMBER", tx);

    const member = await tx.organizationMember.create({
      data: {
        organizationId: ctx.organizationId,
        userId: user.id,
        displayId,
        role: input.role,
        jobTitle: input.jobTitle,
        department: input.department,
        capacity: input.capacity,
        isActive: true,
      },
      select: { id: true },
    });

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.MEMBER_ADDED,
        entityType: EntityType.USER,
        entityId: member.id,
        newValue: `${input.name} (${input.role})`,
      },
      tx,
    );

    return member.id;
  });

  return { memberId };
}

export async function updateMember(
  ctx: OrgContext,
  input: UpdateMemberInput,
): Promise<void> {
  const member = await requireMemberInOrg(ctx, input.memberId);

  // Seniority is checked against the member's CURRENT role and the role being
  // assigned. Checking only one lets an Admin promote a Manager to Owner.
  if (!canManageRole(ctx.role, member.role)) {
    throw new ForbiddenError("You cannot manage a member at or above your own level.");
  }
  if (!canManageRole(ctx.role, input.role)) {
    throw new ForbiddenError("You cannot assign a role at or above your own level.");
  }

  const roleChanged = member.role !== input.role;

  if (roleChanged && member.role === OrgRole.OWNER) {
    const owners = await countActiveOwners(ctx.organizationId);
    if (owners <= 1) {
      throw new MemberOperationError(
        "This is the only active Owner. Promote another Owner first.",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: member.userId },
      data: { name: input.name },
    });

    await tx.organizationMember.update({
      where: { id: member.id },
      data: {
        role: input.role,
        jobTitle: input.jobTitle,
        department: input.department,
        capacity: input.capacity,
      },
    });

    await logActivity(
      ctx,
      {
        action: roleChanged
          ? ACTIVITY_ACTIONS.MEMBER_ROLE_CHANGED
          : ACTIVITY_ACTIONS.MEMBER_UPDATED,
        entityType: EntityType.USER,
        entityId: member.id,
        previousValue: roleChanged ? member.role : null,
        newValue: roleChanged ? input.role : input.name,
      },
      tx,
    );
  });
}

export async function setMemberActive(
  ctx: OrgContext,
  memberId: string,
  isActive: boolean,
): Promise<void> {
  const member = await requireMemberInOrg(ctx, memberId);

  // Deactivating yourself would immediately end your own session, since
  // sign-in requires an active membership. Refuse rather than lock the user out.
  if (member.userId === ctx.userId) {
    throw new MemberOperationError(
      "You cannot change your own active status.",
    );
  }

  if (!canManageRole(ctx.role, member.role)) {
    throw new ForbiddenError(
      "You cannot manage a member at or above your own level.",
    );
  }

  if (!isActive && member.role === OrgRole.OWNER) {
    const owners = await countActiveOwners(ctx.organizationId);
    if (owners <= 1) {
      throw new MemberOperationError(
        "This is the only active Owner. Promote another Owner first.",
      );
    }
  }

  if (member.isActive === isActive) return;

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({
      where: { id: member.id },
      data: { isActive },
    });

    await logActivity(
      ctx,
      {
        action: isActive
          ? ACTIVITY_ACTIONS.MEMBER_REACTIVATED
          : ACTIVITY_ACTIONS.MEMBER_DEACTIVATED,
        entityType: EntityType.USER,
        entityId: member.id,
        previousValue: member.isActive ? "Active" : "Inactive",
        newValue: isActive ? "Active" : "Inactive",
      },
      tx,
    );
  });
}
