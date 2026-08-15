import { cache } from "react";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import {
  ForbiddenError,
  UnauthenticatedError,
  type OrgContext,
} from "@/server/context";

/**
 * Session-aware tenancy.
 *
 * Master prompt §6: isolation is enforced server-side and never by frontend
 * filtering. The rule this module exists to make unavoidable:
 *
 *   Every query against a business table is scoped by `organizationId`, and
 *   that id comes from the authenticated session — never from a request
 *   parameter, a form field, or a URL segment.
 *
 * Route handlers and server actions obtain an `OrgContext` here and pass it
 * to services. A service reaching for a raw `prisma` query on a tenant table
 * without that scope is the bug this design makes visible in review.
 */

// Re-exported so callers have a single import for context plus session.
export {
  assertPermission,
  assertSameOrg,
  ForbiddenError,
  UnauthenticatedError,
  type OrgContext,
} from "@/server/context";

/**
 * The signed-in user's id, or null.
 *
 * Wrapped in React `cache` so multiple server components in one render share
 * a single lookup rather than each hitting the session and database.
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
 * Multi-org membership is supported by the data model; until an organization
 * switcher exists, the earliest active membership is used, which is
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
