import bcrypt from "bcryptjs";

import { EntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { UpdateOrganizationInput } from "@/lib/validation/organization";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { MemberOperationError } from "@/server/services/members";
import type { OrgContext } from "@/server/context";

/** Organization profile and the signed-in user's own account. */

export interface OrganizationProfile {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  timezone: string;
  currency: string;
  locale: string;
}

export async function getOrganization(
  ctx: OrgContext,
): Promise<OrganizationProfile | null> {
  return prisma.organization.findFirst({
    where: { id: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      timezone: true,
      currency: true,
      locale: true,
    },
  });
}

export async function updateOrganization(
  ctx: OrgContext,
  input: UpdateOrganizationInput,
): Promise<void> {
  const current = await getOrganization(ctx);
  if (!current) throw new MemberOperationError("Organization not found.");

  if (input.slug !== current.slug) {
    const taken = await prisma.organization.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (taken && taken.id !== ctx.organizationId) {
      throw new MemberOperationError("That slug is already in use.");
    }
  }

  const changes: string[] = [];
  if (current.name !== input.name) changes.push("name");
  if (current.slug !== input.slug) changes.push("slug");
  if ((current.logoUrl ?? "") !== (input.logoUrl ?? "")) changes.push("logo");
  if (current.timezone !== input.timezone) changes.push("timezone");
  if (current.currency !== input.currency) changes.push("currency");
  if (current.locale !== input.locale) changes.push("locale");

  if (changes.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: ctx.organizationId },
      data: {
        name: input.name,
        slug: input.slug,
        logoUrl: input.logoUrl,
        timezone: input.timezone,
        currency: input.currency,
        locale: input.locale,
      },
    });

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.ORGANIZATION_UPDATED,
        entityType: EntityType.ORGANIZATION,
        entityId: ctx.organizationId,
        previousValue: current.name,
        newValue: input.name,
        comment: `Changed: ${changes.join(", ")}`,
      },
      tx,
    );
  });
}

export async function updateOwnProfile(
  ctx: OrgContext,
  name: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: ctx.userId },
    data: { name },
  });
}

/**
 * Changes the signed-in user's password.
 *
 * Requires the current password even though the session is already
 * authenticated: it stops an unattended logged-in browser from being used to
 * seize the account permanently.
 */
export async function changeOwnPassword(
  ctx: OrgContext,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    throw new MemberOperationError(
      "This account has no password set. Use the reset link instead.",
    );
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new MemberOperationError("Current password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: ctx.userId },
      data: { passwordHash },
    });

    // Any outstanding reset link is void once the password changes.
    await tx.passwordResetToken.deleteMany({
      where: { userId: ctx.userId, usedAt: null },
    });
  });
}
