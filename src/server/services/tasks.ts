import {
  EntityType,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";
import type {
  Frequency,
  Priority,
  ReviewStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TASK_STATUS_LABELS } from "@/lib/domain/labels";
import { nextStatusAllowed, validateTaskFields } from "@/lib/domain/task";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { nextDisplayId } from "@/server/services/ids";
import { recalculateClientHealth } from "@/server/services/health";
import { notifyTaskAssigned } from "@/server/services/notifications";
import { recalculateClientProgress } from "@/server/services/progress";

/**
 * Task service.
 *
 * Port of legacy `tasks/TaskService.gs` (audit §6.3) — the only path that
 * creates or transitions a task, so ID allocation, defaults, the state
 * machine, and activity logging happen in exactly one place regardless of
 * whether the task came from onboarding, monthly generation, or manual entry.
 */

export class TaskOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskOperationError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Input for creating a task.
 *
 * Declared explicitly rather than as `Partial<ExpandedTask>`: the generator
 * always supplies a due date and period, while a manual task may have
 * neither, so the two shapes differ in nullability. An ExpandedTask is
 * assignable to this.
 */
export interface CreateTaskInput {
  clientId: string;
  taskName: string;
  serviceArea: string;
  description?: string | null;
  period?: string | null;
  frequency?: Frequency | null;
  taskTemplateId?: string | null;
  taskCategory?: TaskCategory;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: Date | null;
  startDate?: Date | null;
  completionPct?: number;
  reviewStatus?: ReviewStatus;
  clientDependency?: boolean;
  notes?: string | null;
  waitingFor?: string | null;
  /**
   * Preferred over `assignedToName` when present. Generation resolves a
   * template ROLE to a person by name (audit §6.10); the UI already knows the
   * member id, so it passes that directly rather than round-tripping a name.
   */
  assignedToId?: string | null;
  assignedToName?: string | null;
  reviewerId?: string | null;
}

export interface CreateTaskOptions {
  /**
   * Legacy's `skipLog`. Bulk generators log ONE summary entry for the run
   * instead of one per task — legacy's "skip repetitive logging" rule, which
   * keeps the activity feed readable.
   */
  skipLog?: boolean;
  db?: Db;
}

/** Legacy `createTask`. */
export async function createTask(
  ctx: OrgContext,
  input: CreateTaskInput,
  options: CreateTaskOptions = {},
): Promise<{ id: string; displayId: string }> {
  const validation = validateTaskFields(input);
  if (!validation.valid) {
    throw new TaskOperationError(
      `Invalid task — ${validation.errors.join(" ")}`,
    );
  }

  const db = options.db ?? prisma;

  // Tenant guard: the client must belong to the caller's organization.
  const client = await db.client.findFirst({
    where: {
      id: input.clientId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }

  const assignedToId =
    input.assignedToId !== undefined
      ? await requireMemberId(ctx, input.assignedToId, db)
      : await resolveMemberId(ctx, input.assignedToName ?? null, db);

  const reviewerId =
    input.reviewerId !== undefined
      ? await requireMemberId(ctx, input.reviewerId, db)
      : null;

  const displayId = await nextDisplayId(ctx.organizationId, "TASK", db);

  const task = await db.task.create({
    data: {
      organizationId: ctx.organizationId,
      displayId,
      clientId: input.clientId,
      serviceArea: input.serviceArea,
      taskCategory: input.taskCategory ?? TaskCategory.AD_HOC,
      taskName: input.taskName,
      description: input.description ?? null,
      period: input.period ?? null,
      frequency: input.frequency ?? null,
      taskTemplateId: input.taskTemplateId ?? null,
      assignedToId,
      reviewerId,
      priority: input.priority ?? "MEDIUM",
      status: input.status ?? TaskStatus.NOT_STARTED,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      notes: input.notes ?? null,
      waitingFor: input.waitingFor ?? null,
      clientDependency: input.clientDependency ?? false,
      completionPct: input.completionPct ?? 0,
      reviewStatus: input.reviewStatus ?? "NOT_REVIEWED",
    },
    select: { id: true, displayId: true },
  });

  if (!options.skipLog) {
    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.TASK_CREATED,
        entityType: EntityType.TASK,
        entityId: task.id,
        clientId: input.clientId,
        newValue: input.taskName,
      },
      db,
    );
  }

  // Phase 11. Gated on the same `skipLog` flag as the activity entry, and for
  // the same reason: bulk generation creates hundreds of tasks in one pass,
  // and a notification per row would bury every real one. Generation instead
  // sends one summary notice (see `notifySystem` in the monthly job).
  if (assignedToId && !options.skipLog) {
    await notifyTaskAssigned(ctx, task.id);
  }

  return task;
}

/**
 * Verifies a member id belongs to the caller's organization.
 *
 * The id comes from a form, so it is never trusted — a foreign id would
 * otherwise assign this organization's work to another tenant's staff.
 */
async function requireMemberId(
  ctx: OrgContext,
  memberId: string | null,
  db: Db,
): Promise<string | null> {
  if (!memberId) return null;

  const member = await db.organizationMember.findFirst({
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

async function resolveMemberId(
  ctx: OrgContext,
  memberName: string | null,
  db: Db,
): Promise<string | null> {
  if (!memberName) return null;

  const member = await db.organizationMember.findFirst({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      user: { name: memberName },
    },
    select: { id: true },
  });

  return member?.id ?? null;
}

/**
 * Legacy `updateTaskStatus` — enforces the state machine and its side effects.
 *
 * Moving to Completed stamps the completion date and sets 100%; reopening
 * clears the date. Progress and health are recalculated afterwards, matching
 * legacy's onEdit handler, so the client's numbers never lag a status change.
 */
export async function updateTaskStatus(
  ctx: OrgContext,
  taskId: string,
  newStatus: TaskStatus,
  today: Date = new Date(),
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: { id: true, status: true, clientId: true, taskName: true },
  });
  if (!task) throw new ForbiddenError("Task not found in this organization.");

  if (!nextStatusAllowed(task.status, newStatus)) {
    throw new TaskOperationError(
      `"${TASK_STATUS_LABELS[task.status]}" → "${TASK_STATUS_LABELS[newStatus]}" is not an allowed status transition.`,
    );
  }

  if (task.status === newStatus) return;

  const data: Prisma.TaskUpdateInput = { status: newStatus };

  if (newStatus === TaskStatus.COMPLETED) {
    data.completionDate = today;
    data.completionPct = 1;
  } else if (task.status === TaskStatus.COMPLETED) {
    data.completionDate = null;
  }

  await prisma.task.update({ where: { id: taskId }, data });

  await prisma.taskStatusHistory.create({
    data: {
      taskId,
      fromStatus: task.status,
      toStatus: newStatus,
      changedById: ctx.membershipId,
    },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.TASK_STATUS_CHANGED,
    entityType: EntityType.TASK,
    entityId: taskId,
    clientId: task.clientId,
    previousValue: TASK_STATUS_LABELS[task.status],
    newValue: TASK_STATUS_LABELS[newStatus],
  });

  await recalculateClientProgress(ctx.organizationId, task.clientId);
  await recalculateClientHealth(ctx, task.clientId, today);
}

/** Legacy `reassignTask`. */
export async function reassignTask(
  ctx: OrgContext,
  taskId: string,
  newMemberId: string | null,
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      assignedToId: true,
      assignedTo: { select: { user: { select: { name: true } } } },
    },
  });
  if (!task) throw new ForbiddenError("Task not found in this organization.");

  if (newMemberId) {
    const member = await prisma.organizationMember.findFirst({
      where: {
        id: newMemberId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenError("Member not found in this organization.");
    }
  }

  if (task.assignedToId === newMemberId) return;

  const next = newMemberId
    ? await prisma.organizationMember.findUnique({
        where: { id: newMemberId },
        select: { user: { select: { name: true } } },
      })
    : null;

  await prisma.task.update({
    where: { id: taskId },
    data: { assignedToId: newMemberId },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.TASK_REASSIGNED,
    entityType: EntityType.TASK,
    entityId: taskId,
    clientId: task.clientId,
    previousValue: task.assignedTo?.user.name ?? "Unassigned",
    newValue: next?.user.name ?? "Unassigned",
  });
}
