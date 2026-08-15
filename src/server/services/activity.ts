import type { EntityType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { nextDisplayId } from "@/server/services/ids";
import type { OrgContext } from "@/server/context";

/**
 * Activity logging.
 *
 * Port of legacy `automation/ActivityLogger.gs` (audit §6.14). Two behaviors
 * from that file are load-bearing and preserved:
 *
 * 1. **Single append path.** Every service calls this rather than writing
 *    ACTIVITY_LOG directly, so the audit trail cannot drift between callers.
 *
 * 2. **It also stamps the client's last activity.** Legacy defined
 *    `CLIENTS.Last Activity` as "most recent ACTIVITY_LOG timestamp for the
 *    client", and this was the one place that was true. Splitting the two
 *    writes apart would let the column go stale.
 *
 * The legacy rule that pure recalculation writes are NEVER logged is also
 * preserved — engines that only recompute a derived value do not call this.
 *
 * DEVIATION (audit D4): legacy linked activity to a client by NAME, so
 * renaming a client orphaned its history. This uses `clientId`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Action names. Legacy used free-text strings; these are the same values, centralized. */
export const ACTIVITY_ACTIONS = {
  CLIENT_ADDED: "Client Added",
  CLIENT_UPDATED: "Client Updated",
  CLIENT_ARCHIVED: "Client Archived",
  CLIENT_HEALTH_CHANGED: "Client Health Changed",
  TASK_CREATED: "Task Created",
  TASK_STATUS_CHANGED: "Task Status Changed",
  TASK_REASSIGNED: "Task Reassigned",
  TASK_UPDATED: "Task Updated",
  TASK_DELETED: "Task Deleted",
  ONBOARDING_TASKS_GENERATED: "Onboarding Tasks Generated",
  MONTHLY_TASKS_GENERATED: "Monthly Tasks Generated",
  ISSUE_CREATED: "Issue Created",
  ISSUE_RESOLVED: "Issue Resolved",
  /**
   * Net-new. Legacy logged only the resolve path (`resolveIssue`); every
   * other status move was a direct sheet edit its `onEdit` handler ignored,
   * so it left no trace. A web backend has no unlogged edit path, and leaving
   * these silent would be a worse audit trail than legacy's, not a faithful
   * one.
   */
  ISSUE_STATUS_CHANGED: "Issue Status Changed",
  ISSUE_UPDATED: "Issue Updated",
  /**
   * Legacy strings verbatim: `ClientRequestService.gs` logs "Client Request
   * Created" and "Client Request Status Changed". These constants previously
   * read "Request Created"/"Request Updated"; nothing consumed them yet, and
   * the activity feed is user-visible legacy output, so they are corrected to
   * the originals here rather than left divergent.
   */
  REQUEST_CREATED: "Client Request Created",
  REQUEST_STATUS_CHANGED: "Client Request Status Changed",
  REQUEST_UPDATED: "Client Request Updated",
  MEMBER_ADDED: "Member Added",
  MEMBER_UPDATED: "Member Updated",
  MEMBER_DEACTIVATED: "Member Deactivated",
  MEMBER_REACTIVATED: "Member Reactivated",
  MEMBER_ROLE_CHANGED: "Member Role Changed",
  ORGANIZATION_UPDATED: "Organization Updated",
  SETTINGS_CHANGED: "Settings Changed",
  THEME_CHANGED: "Theme Changed",
} as const;

export type ActivityAction =
  (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

export interface LogActivityInput {
  action: ActivityAction;
  entityType: EntityType;
  entityId?: string | null;
  /** Human-readable prior value, for a change entry. */
  previousValue?: string | null;
  newValue?: string | null;
  /** Set when the activity concerns a client — also refreshes its lastActivityAt. */
  clientId?: string | null;
  comment?: string | null;
}

export async function logActivity(
  ctx: OrgContext,
  input: LogActivityInput,
  db: Db = prisma,
): Promise<void> {
  const displayId = await nextDisplayId(ctx.organizationId, "ACTIVITY", db);
  const now = new Date();

  await db.activityLog.create({
    data: {
      organizationId: ctx.organizationId,
      displayId,
      userId: ctx.userId,
      // Snapshot, so the entry stays readable if the user is later removed.
      userEmail: ctx.userEmail,
      clientId: input.clientId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      comment: input.comment ?? null,
      createdAt: now,
    },
  });

  // Legacy touchClientLastActivity() — same timestamp as the log entry.
  if (input.clientId) {
    await db.client.update({
      where: { id: input.clientId },
      data: { lastActivityAt: now },
    });
  }
}

/**
 * Security/technical audit trail — net-new (master prompt §35), separate from
 * the user-facing activity log above. Sign-ins, permission changes, exports.
 */
export async function logAudit(
  input: {
    organizationId?: string | null;
    userId?: string | null;
    userEmail?: string | null;
    action: string;
    entityType?: EntityType | null;
    entityId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
  db: Db = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}
