import { cache } from "react";

import { auth } from "@/auth";
import type { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  hasPermission,
  type Permission,
} from "@/server/auth/permissions";

/**
 * Tenant isolation.
 *
 * Master prompt §6: isolation is enforced server-side and never by frontend
 * filtering. The rule this module exists to make unavoidable:
 *
 *   Every query against a business table is scoped by `organizationId`, and
 *   that id comes from the authenticated session — never from a request
 *   parameter, a form field, or a URL segment.
 *
 * Route handlers and server actions obtain an `OrgContext` here and use
 * `ctx.organizationId`. A caller that reaches for a raw `prisma` query on a
 * tenant table without that scope is the bug this design is meant to make
 * visible in review.
 */

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface OrgContext {
  readonly userId: string;
  readonly userEmail: string;
  readonly userName: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly membershipId: string;
  readonly role: OrgRole;
}

/**
 * The signed-in user's id, or null.
 *
 * Wrapped in React `cache` so multiple server components in one render share a
 * single lookup rather than each hitting the session and database.
 */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new UnauthenticatedError();
  return userId;
}

/**
 * Resolves the caller's active organization context.
 *
 * Multi-org users are supported by the data model; until an organization
 * switcher exists (Phase 2), the earliest active membership is used, which is
 * deterministic rather than arbitrary.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      isActive: true,
      deletedAt: null,
      organization: { deletedAt: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      organizationId: true,
      organization: { select: { slug: true } },
      user: { select: { email: true, name: true } },
    },
  });

  if (!membership) return null;

  return {
    userId,
    userEmail: membership.user.email,
    userName: membership.user.name,
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    membershipId: membership.id,
    role: membership.role,
  };
});

export async function requireOrgContext(): Promise<OrgContext> {
  const context = await getOrgContext();
  if (!context) throw new UnauthenticatedError();
  return context;
}

/**
 * Resolves the org context and asserts a permission in one step — the normal
 * entry point for a server action.
 */
export async function requirePermission(
  permission: Permission,
): Promise<OrgContext> {
  const context = await requireOrgContext();
  if (!hasPermission(context.role, permission)) {
    throw new ForbiddenError();
  }
  return context;
}

export function assertPermission(
  context: OrgContext,
  permission: Permission,
): void {
  if (!hasPermission(context.role, permission)) {
    throw new ForbiddenError();
  }
}

/**
 * Guards a record fetched by id against cross-tenant access.
 *
 * Defence in depth: queries should already filter by `organizationId`. This
 * catches the case where one did not, turning a data leak into an error.
 */
export function assertSameOrg(
  context: OrgContext,
  record: { organizationId: string } | null,
): void {
  if (!record || record.organizationId !== context.organizationId) {
    throw new ForbiddenError("Record not found in this organization.");
  }
}
