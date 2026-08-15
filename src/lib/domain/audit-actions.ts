/**
 * The `AuditLog.action` vocabulary, and how to present it.
 *
 * Pure, and deliberately in `lib/domain` rather than beside the query module
 * that reads the table: the filter control on `/settings/security` is a Client
 * Component, and importing these from the query module would pull Prisma —
 * and through it `pg`, `dns`, and `fs` — into the browser bundle. That does
 * not fail in development, where the modules are evaluated on the server
 * either way; it fails at `next build`.
 */

/**
 * Human wording for the action codes this codebase writes.
 *
 * Unknown codes fall through to the raw string rather than to "Unknown": an
 * audit reader that hides what it cannot label is worse than one that shows a
 * machine-readable value.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "sign_in.success": "Signed in",
  "sign_in.bad_password": "Wrong password",
  "sign_in.unknown_or_disabled": "Unknown or disabled account",
  "sign_in.no_active_membership": "No active membership",
  "sign_in.rate_limited": "Blocked — too many attempts",
  "password_reset.requested": "Requested a password reset",
  "password_reset.rate_limited": "Blocked — too many reset requests",
  "data.export": "Exported data",
  "data.import": "Imported data",
  "organization.bootstrapped": "Organization created",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/**
 * True for the actions an administrator should look at twice.
 *
 * A password reset *request* is not one of them — people forget passwords —
 * but a refused one means somebody sent enough of them to hit the limit.
 */
export function isSecurityConcern(action: string): boolean {
  return (
    (action.startsWith("sign_in.") && action !== "sign_in.success") ||
    action === "password_reset.rate_limited"
  );
}
