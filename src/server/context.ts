import type { OrgRole } from "@/generated/prisma/enums";
import { hasPermission, type Permission } from "@/server/auth/permissions";

/**
 * Request context and access errors.
 *
 * Deliberately free of any Auth.js import. Services depend on this module
 * rather than on `tenancy.ts`, so the service layer has no dependency on the
 * authentication framework — which keeps it testable outside a Next.js
 * request and stops the auth library leaking into business code.
 *
 * `tenancy.ts` is the session-aware layer that produces an OrgContext; it
 * re-exports everything here so callers have a single import.
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

/**
 * Everything a service needs to act on behalf of a user, resolved once per
 * request. `organizationId` always comes from the session — never from a
 * route parameter, form field, or request body.
 */
export interface OrgContext {
  readonly userId: string;
  readonly userEmail: string;
  readonly userName: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly membershipId: string;
  readonly role: OrgRole;
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
