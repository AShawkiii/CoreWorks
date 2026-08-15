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
  /**
   * Null only for a scheduled run, which has no signed-in user (audit §9).
   * `ActivityLog.userId` is nullable for the same reason and carries a
   * `userEmail` snapshot alongside, so a system-written entry still reads
   * sensibly. Every request-scoped context has a real id.
   */
  readonly userId: string | null;
  readonly userEmail: string;
  readonly userName: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  /** Null for a scheduled run — a job is not a member of the organization. */
  readonly membershipId: string | null;
  readonly role: OrgRole;
}

/**
 * The identity a scheduled job writes activity under.
 *
 * Legacy's triggers wrote as whoever owned the script; CoreWorks records the
 * absence of a person explicitly rather than attributing a nightly
 * recalculation to a member of staff.
 */
export const SYSTEM_ACTOR_EMAIL = "system@coreworks.local";

export function systemContext(
  organizationId: string,
  organizationSlug: string,
  role: OrgRole,
): OrgContext {
  return {
    userId: null,
    userEmail: SYSTEM_ACTOR_EMAIL,
    userName: "Scheduled job",
    organizationId,
    organizationSlug,
    membershipId: null,
    role,
  };
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

/**
 * The signed-in user's id, for operations that are meaningless without one.
 *
 * Changing your own password or profile is inherently a person's action; a
 * scheduled job reaching one of these would be a bug, so it fails loudly here
 * rather than writing against a null id.
 */
export function requireUserId(ctx: OrgContext): string {
  if (ctx.userId === null) {
    throw new ForbiddenError("This action requires a signed-in user.");
  }
  return ctx.userId;
}
