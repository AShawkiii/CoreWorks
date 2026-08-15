import { EntityType, TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { TASK_STATUS_LABELS } from "@/lib/domain/labels";
import { nextStatusAllowed } from "@/lib/domain/task";
import type { UpdateTaskInput } from "@/lib/validation/task";
import {
  ForbiddenError,
  requireUserId,
  type OrgContext,
} from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { recalculateClientHealth } from "@/server/services/health";
import {
  notifyMentions,
  notifyTaskAssigned,
  notifyTasksAssigned,
} from "@/server/services/notifications";
import { recalculateClientProgress } from "@/server/services/progress";
import { TaskOperationError, updateTaskStatus } from "@/server/services/tasks";

/**
 * Task mutations beyond create and status change.
 *
 * Field edits are kept separate from status changes on purpose: legacy
 * treated a status edit as a distinct event with side effects (completion
 * stamping, activity logging, progress and health recalculation). Folding the
 * two together would either skip those effects or fire them on every trivial
 * edit.
 */

/** Loads a task, guaranteeing it belongs to the caller's organization. */
async function requireTaskInOrg(ctx: OrgContext, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      taskName: true,
      status: true,
      priority: true,
      dueDate: true,
      assignedToId: true,
    },
  });
  if (!task) throw new ForbiddenError("Task not found in this organization.");
  return task;
}

async function requireMemberInOrg(
  ctx: OrgContext,
  memberId: string | null,
): Promise<string | null> {
  if (!memberId) return null;

  const member = await prisma.organizationMember.findFirst({
    where: {
      id: memberId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!member) {
    throw new ForbiddenError("Member not found in this organization.");
  }
  return member.id;
}

/**
 * Updates a task's editable fields.
 *
 * Status is deliberately absent — it moves only through `updateTaskStatus`,
 * so the state machine can never be bypassed by a field edit.
 */
export async function updateTaskDetails(
  ctx: OrgContext,
  input: UpdateTaskInput,
): Promise<void> {
  const task = await requireTaskInOrg(ctx, input.taskId);

  // The client can be reassigned, so the target must be checked too.
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }

  const assignedToId = await requireMemberInOrg(ctx, input.assignedToId);
  const reviewerId = await requireMemberInOrg(ctx, input.reviewerId);

  const dueDateChanged =
    (task.dueDate?.getTime() ?? null) !== (input.dueDate?.getTime() ?? null);
  const priorityChanged = task.priority !== input.priority;
  const clientChanged = task.clientId !== input.clientId;
  const assigneeChanged = task.assignedToId !== assignedToId;

  await prisma.task.update({
    where: { id: input.taskId },
    data: {
      clientId: input.clientId,
      taskName: input.taskName,
      serviceArea: input.serviceArea,
      description: input.description,
      period: input.period,
      assignedToId,
      reviewerId,
      priority: input.priority,
      dueDate: input.dueDate,
      startDate: input.startDate,
      reviewStatus: input.reviewStatus,
      clientDependency: input.clientDependency ?? false,
      waitingFor: input.waitingFor,
      notes: input.notes,
    },
  });

  await logActivity(ctx, {
    action: assigneeChanged
      ? ACTIVITY_ACTIONS.TASK_REASSIGNED
      : ACTIVITY_ACTIONS.TASK_UPDATED,
    entityType: EntityType.TASK,
    entityId: input.taskId,
    clientId: input.clientId,
    previousValue: task.taskName,
    newValue: input.taskName,
  });

  // Phase 11. Only when the assignee actually changed, and only when there is
  // one — clearing an assignment is not something to notify the empty seat
  // about. The previous assignee is deliberately not told they lost the task;
  // that is a management conversation, not a system message.
  if (assigneeChanged && assignedToId) {
    await notifyTaskAssigned(ctx, input.taskId);
  }

  // Priority and due date feed weighted completion and overdue-ness, so a
  // change to either must re-derive the client's numbers rather than wait for
  // the nightly pass. Moving a task between clients affects both.
  if (priorityChanged || dueDateChanged || clientChanged) {
    await recalculateClientProgress(ctx.organizationId, input.clientId);
    await recalculateClientHealth(ctx, input.clientId);

    if (clientChanged) {
      await recalculateClientProgress(ctx.organizationId, task.clientId);
      await recalculateClientHealth(ctx, task.clientId);
    }
  }
}

export interface BulkResult {
  updated: number;
  skipped: number;
  /** Human-readable reasons, so a partial bulk run explains itself. */
  errors: string[];
}

/**
 * Bulk status change (master prompt §12).
 *
 * Each task is evaluated against the state machine individually — a task
 * whose current status forbids the move is SKIPPED and reported, not forced.
 * Silently applying it would corrupt exactly the audit trail the state
 * machine exists to protect.
 */
export async function bulkUpdateStatus(
  ctx: OrgContext,
  taskIds: string[],
  status: TaskStatus,
  today: Date = new Date(),
): Promise<BulkResult> {
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true, status: true, taskName: true, displayId: true },
  });

  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };

  // Ids not returned belong to another organization or do not exist; they are
  // counted as skipped without saying which, so the count cannot be used to
  // probe for existence.
  const foundIds = new Set(tasks.map((task) => task.id));
  const missing = taskIds.filter((id) => !foundIds.has(id));
  result.skipped += missing.length;
  if (missing.length > 0) {
    result.errors.push(`${missing.length} task(s) were not available.`);
  }

  for (const task of tasks) {
    if (task.status === status) {
      result.skipped += 1;
      continue;
    }

    if (!nextStatusAllowed(task.status, status)) {
      result.skipped += 1;
      result.errors.push(
        `${task.displayId}: "${TASK_STATUS_LABELS[task.status]}" → "${TASK_STATUS_LABELS[status]}" is not allowed.`,
      );
      continue;
    }

    await updateTaskStatus(ctx, task.id, status, today);
    result.updated += 1;
  }

  return result;
}

/** Bulk reassignment. Assignment has no state machine, so every task moves. */
export async function bulkReassign(
  ctx: OrgContext,
  taskIds: string[],
  assignedToId: string | null,
): Promise<BulkResult> {
  const memberId = await requireMemberInOrg(ctx, assignedToId);

  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true, clientId: true, assignedToId: true },
  });

  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };

  const foundIds = new Set(tasks.map((task) => task.id));
  const missing = taskIds.filter((id) => !foundIds.has(id));
  result.skipped += missing.length;
  if (missing.length > 0) {
    result.errors.push(`${missing.length} task(s) were not available.`);
  }

  const toMove = tasks.filter((task) => task.assignedToId !== memberId);
  result.skipped += tasks.length - toMove.length;

  if (toMove.length === 0) return result;

  await prisma.task.updateMany({
    where: { id: { in: toMove.map((task) => task.id) } },
    data: { assignedToId: memberId },
  });

  const name = memberId
    ? await prisma.organizationMember.findUnique({
        where: { id: memberId },
        select: { user: { select: { name: true } } },
      })
    : null;

  // One summary entry for the run, matching legacy's rule that bulk
  // operations do not flood the activity feed with one row per record.
  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.TASK_REASSIGNED,
    entityType: EntityType.TASK,
    entityId: null,
    newValue: `${toMove.length} task(s) → ${name?.user.name ?? "Unassigned"}`,
  });

  // Phase 11. One notification per task here, unlike the single summary
  // activity entry above, because the two answer different questions: the feed
  // records that a bulk run happened, while the new assignee needs each task
  // individually — a "you now own 12 tasks" notice they cannot click through
  // is not actionable. Unassignment sends nothing.
  if (memberId) {
    await notifyTasksAssigned(
      ctx,
      toMove.map((task) => task.id),
    );
  }

  result.updated = toMove.length;
  return result;
}

/** Soft-deletes a task. Cancelling is usually the right move; this is for mistakes. */
export async function deleteTask(
  ctx: OrgContext,
  taskId: string,
): Promise<void> {
  const task = await requireTaskInOrg(ctx, taskId);

  await prisma.task.update({
    where: { id: taskId },
    data: { deletedAt: new Date() },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.TASK_DELETED,
    entityType: EntityType.TASK,
    entityId: taskId,
    clientId: task.clientId,
    previousValue: task.taskName,
  });

  await recalculateClientProgress(ctx.organizationId, task.clientId);
  await recalculateClientHealth(ctx, task.clientId);
}

// ---------------------------------------------------------------------------
// Comments (master prompt §43)
// ---------------------------------------------------------------------------

export async function addTaskComment(
  ctx: OrgContext,
  taskId: string,
  body: string,
): Promise<void> {
  const task = await requireTaskInOrg(ctx, taskId);

  await prisma.comment.create({
    data: {
      organizationId: ctx.organizationId,
      authorId: ctx.userId,
      body,
      taskId: task.id,
    },
  });

  await notifyMentions(ctx, body, {
    href: `/tasks/${task.id}`,
    entityType: EntityType.TASK,
    entityId: task.id,
    label: task.taskName,
  });
}

/**
 * Soft-deletes a comment.
 *
 * Only the author may remove their own; anyone else editing the record would
 * make the discussion unreliable. Managers can still see it — removal is not
 * a moderation tool here.
 */
export async function deleteTaskComment(
  ctx: OrgContext,
  taskId: string,
  commentId: string,
): Promise<void> {
  await requireTaskInOrg(ctx, taskId);

  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      taskId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    throw new ForbiddenError("Comment not found.");
  }

  // requireUserId, not a bare compare: a comment whose author was deleted
  // has a null authorId, and a null-vs-null match would let anyone remove it.
  if (comment.authorId !== requireUserId(ctx)) {
    throw new TaskOperationError("You can only delete your own comments.");
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
}
