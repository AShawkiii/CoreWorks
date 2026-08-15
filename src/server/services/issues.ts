import { EntityType, IssueStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ISSUE_CLOSED_STATUSES } from "@/lib/domain/enums";
import { ISSUE_STATUS_LABELS } from "@/lib/domain/labels";
import type { CreateIssueInput, UpdateIssueInput } from "@/lib/validation/issue";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { nextDisplayId } from "@/server/services/ids";
import { recalculateClientHealth } from "@/server/services/health";

/**
 * Issue service.
 *
 * Port of legacy `issues/IssueService.gs` (audit §6.5).
 *
 * **Issues have no state machine.** Legacy's `onEdit` handler routed only
 * `TASKS.Status` (`automation/Triggers.gs:21-34`); an issue's Status was a
 * plain dropdown with no transition validation, so any status could follow
 * any other. That is preserved deliberately — inventing a machine here would
 * be a new business rule, not a migration.
 *
 * What legacy DID enforce is the resolve side effect, and that is kept
 * exactly: moving to Resolved stamps a Resolution Date, and the activity
 * entry is written only when the status actually changed.
 */

export class IssueOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueOperationError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Verifies a client belongs to the caller's organization. */
async function requireClientInOrg(
  ctx: OrgContext,
  clientId: string,
  db: Db = prisma,
): Promise<{ id: string; name: string }> {
  const client = await db.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }
  return client;
}

/**
 * Verifies a member id belongs to the caller's organization.
 *
 * The id arrives from a form and is never trusted — a foreign id would
 * otherwise assign this organization's work to another tenant's staff.
 */
async function requireMemberInOrg(
  ctx: OrgContext,
  memberId: string | null,
  db: Db = prisma,
): Promise<string | null> {
  if (!memberId) return null;

  const member = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!member) {
    throw new ForbiddenError("Member not found in this organization.");
  }
  return member.id;
}

async function requireIssueInOrg(ctx: OrgContext, issueId: string) {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      title: true,
      status: true,
      severity: true,
      deadline: true,
    },
  });
  if (!issue) throw new ForbiddenError("Issue not found in this organization.");
  return issue;
}

/**
 * Legacy `createIssue`.
 *
 * Legacy required exactly two fields and defaulted two others:
 * `Status` to Open and `Date Raised` to today. Both defaults live here rather
 * than in the schema, so a caller bypassing the form still gets them.
 */
export async function createIssue(
  ctx: OrgContext,
  input: CreateIssueInput,
  today: Date = new Date(),
): Promise<{ id: string; displayId: string }> {
  if (!input.clientId || !input.title) {
    throw new IssueOperationError("Client and Issue are required.");
  }

  const client = await requireClientInOrg(ctx, input.clientId);
  const assignedToId = await requireMemberInOrg(ctx, input.assignedToId);

  const issue = await prisma.$transaction(async (tx) => {
    const displayId = await nextDisplayId(ctx.organizationId, "ISSUE", tx);

    return tx.issue.create({
      data: {
        organizationId: ctx.organizationId,
        displayId,
        clientId: client.id,
        title: input.title,
        category: input.category,
        impact: input.impact,
        description: input.description,
        severity: input.severity,
        status: IssueStatus.OPEN,
        assignedToId,
        dateRaised: input.dateRaised ?? today,
        deadline: input.deadline,
        requiredAction: input.requiredAction,
        notes: input.notes,
      },
      select: { id: true, displayId: true },
    });
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.ISSUE_CREATED,
    entityType: EntityType.ISSUE,
    entityId: issue.id,
    clientId: client.id,
    newValue: input.title,
  });

  // An open Critical issue forces Delayed, and an open High forces At Risk
  // (audit §6.1), so a new issue can change the client's health immediately.
  await recalculateClientHealth(ctx, client.id, today);

  return issue;
}

/**
 * Updates an issue's editable fields.
 *
 * Status is deliberately absent — it moves only through `changeIssueStatus`,
 * so the resolve side effects can never be skipped by a field edit.
 */
export async function updateIssue(
  ctx: OrgContext,
  input: UpdateIssueInput,
  today: Date = new Date(),
): Promise<void> {
  const existing = await requireIssueInOrg(ctx, input.issueId);

  const client = await requireClientInOrg(ctx, input.clientId);
  const assignedToId = await requireMemberInOrg(ctx, input.assignedToId);

  const severityChanged = existing.severity !== input.severity;
  const deadlineChanged =
    (existing.deadline?.getTime() ?? null) !== (input.deadline?.getTime() ?? null);
  const clientChanged = existing.clientId !== client.id;

  await prisma.issue.update({
    where: { id: input.issueId },
    data: {
      clientId: client.id,
      title: input.title,
      category: input.category,
      impact: input.impact,
      description: input.description,
      severity: input.severity,
      assignedToId,
      // Date Raised is not nullable in legacy — clearing the field in the
      // form leaves the original date rather than blanking it.
      dateRaised: input.dateRaised ?? undefined,
      deadline: input.deadline,
      requiredAction: input.requiredAction,
      notes: input.notes,
    },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.ISSUE_UPDATED,
    entityType: EntityType.ISSUE,
    entityId: input.issueId,
    clientId: client.id,
    previousValue: existing.title,
    newValue: input.title,
  });

  // Severity and deadline both feed the health rule; moving the issue between
  // clients affects both sides.
  if (severityChanged || deadlineChanged || clientChanged) {
    await recalculateClientHealth(ctx, client.id, today);
    if (clientChanged) {
      await recalculateClientHealth(ctx, existing.clientId, today);
    }
  }
}

/**
 * Legacy `resolveIssue`, generalized to every status.
 *
 * Legacy exposed only a resolve path; the other statuses were reachable by
 * direct sheet edit and left no trace. The resolve behaviour is preserved
 * exactly:
 *
 *  - Moving to Resolved stamps a Resolution Date, defaulting to today unless
 *    one is supplied — `resolveIssue(issueId, resolutionDate)`.
 *  - The activity entry is written only when the status actually changed.
 *
 * Moving back out of a closed status clears the Resolution Date, mirroring
 * how reopening a completed task clears its completion date.
 */
export async function changeIssueStatus(
  ctx: OrgContext,
  issueId: string,
  newStatus: IssueStatus,
  options: { resolutionDate?: Date | null; resolution?: string | null } = {},
  today: Date = new Date(),
): Promise<void> {
  const issue = await requireIssueInOrg(ctx, issueId);

  if (issue.status === newStatus) return;

  const data: Prisma.IssueUpdateInput = { status: newStatus };

  const wasClosed = ISSUE_CLOSED_STATUSES.includes(issue.status);
  const isClosed = ISSUE_CLOSED_STATUSES.includes(newStatus);

  if (newStatus === IssueStatus.RESOLVED) {
    data.resolutionDate = options.resolutionDate ?? today;
  } else if (wasClosed && !isClosed) {
    data.resolutionDate = null;
  }

  if (options.resolution !== undefined && options.resolution !== null) {
    data.resolution = options.resolution;
  }

  await prisma.issue.update({ where: { id: issueId }, data });

  await logActivity(ctx, {
    action:
      newStatus === IssueStatus.RESOLVED
        ? ACTIVITY_ACTIONS.ISSUE_RESOLVED
        : ACTIVITY_ACTIONS.ISSUE_STATUS_CHANGED,
    entityType: EntityType.ISSUE,
    entityId: issueId,
    clientId: issue.clientId,
    previousValue: ISSUE_STATUS_LABELS[issue.status],
    newValue: ISSUE_STATUS_LABELS[newStatus],
  });

  // Opening or closing an issue moves it in and out of the health rule.
  await recalculateClientHealth(ctx, issue.clientId, today);
}
