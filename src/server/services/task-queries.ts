import type { Prisma } from "@/generated/prisma/client";
import { Priority, TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { computeDaysOverdue, computeDaysRemaining, toDateOnly } from "@/lib/domain/date";
import { TASK_CLOSED_STATUSES } from "@/lib/domain/enums";
import { nextStatusAllowed } from "@/lib/domain/task";
import type { DomainTask } from "@/lib/domain/types";
import type { TaskListQuery } from "@/lib/validation/task";
import type { OrgContext } from "@/server/context";
import { taskSelect, toDomainTask } from "@/server/services/mappers";

/**
 * Task queries.
 *
 * Reads only. Derived values — days remaining, days overdue, which
 * transitions are allowed — come from the Phase 3 domain functions rather
 * than being recomputed here.
 */

export const TASKS_PAGE_SIZE = 50;

export interface TaskListRow {
  id: string;
  displayId: string;
  taskName: string;
  serviceArea: string;
  clientId: string;
  clientName: string;
  status: TaskStatus;
  priority: Priority;
  assignedToName: string | null;
  dueDate: Date | null;
  daysRemaining: number | null;
  daysOverdue: number;
  period: string | null;
}

export interface TaskListResult {
  rows: TaskListRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Start of today, local — the boundary `computeDaysOverdue` uses.
 *
 * The SQL overdue filter must agree with the domain rule, or the list would
 * show a different set than the count beside it. Both treat "overdue" as
 * `dueDate` strictly before today's calendar date.
 */
function startOfToday(today: Date): Date {
  return toDateOnly(today);
}

export async function listTasks(
  ctx: OrgContext,
  query: TaskListQuery,
  today: Date = new Date(),
): Promise<TaskListResult> {
  const where: Prisma.TaskWhereInput = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };

  if (query.q) {
    where.OR = [
      { taskName: { contains: query.q, mode: "insensitive" } },
      { displayId: { contains: query.q, mode: "insensitive" } },
      { serviceArea: { contains: query.q, mode: "insensitive" } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  if (query.clientId && query.clientId !== "ALL") {
    where.clientId = query.clientId;
  }

  if (query.status && query.status !== "ALL") {
    // "OPEN" is the useful default view: everything still live.
    where.status =
      query.status === "OPEN"
        ? { notIn: [...TASK_CLOSED_STATUSES] }
        : query.status;
  }

  if (query.priority && query.priority !== "ALL") {
    where.priority = query.priority;
  }

  if (query.assignedToId && query.assignedToId !== "ALL") {
    where.assignedToId =
      query.assignedToId === "UNASSIGNED" ? null : query.assignedToId;
  }

  if (query.period && query.period !== "ALL") {
    where.period = query.period;
  }

  if (query.overdue) {
    // Mirrors computeDaysOverdue: open, has a due date, date already passed.
    where.status = { notIn: [...TASK_CLOSED_STATUSES] };
    where.dueDate = { lt: startOfToday(today) };
  }

  const total = await prisma.task.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / TASKS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    query.sort === "priority"
      ? [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "client"
        ? [{ client: { name: "asc" } }, { dueDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "status"
          ? [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }]
          : query.sort === "created"
            ? [{ createdAt: "desc" }]
            : [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }];

  const rows = await prisma.task.findMany({
    where,
    select: taskSelect,
    orderBy,
    skip: (page - 1) * TASKS_PAGE_SIZE,
    take: TASKS_PAGE_SIZE,
  });

  return {
    rows: rows.map(toDomainTask).map((task) => toListRow(task, today)),
    total,
    page,
    pageCount,
  };
}

function toListRow(task: DomainTask, today: Date): TaskListRow {
  return {
    id: task.id,
    displayId: task.displayId,
    taskName: task.taskName,
    serviceArea: task.serviceArea,
    clientId: task.clientId,
    clientName: task.clientName,
    status: task.status,
    priority: task.priority,
    assignedToName: task.assignedToName,
    dueDate: task.dueDate,
    daysRemaining: computeDaysRemaining(task.dueDate, task.status, today),
    daysOverdue: computeDaysOverdue(task.dueDate, task.status, today),
    period: task.period,
  };
}

export interface TaskComment {
  id: string;
  body: string;
  authorName: string | null;
  authorId: string | null;
  createdAt: Date;
}

export interface TaskHistoryEntry {
  id: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  changedAt: Date;
  changedByName: string | null;
}

export interface TaskDetail {
  task: DomainTask;
  description: string | null;
  notes: string | null;
  waitingFor: string | null;
  clientDependency: boolean;
  startDate: Date | null;
  taskCategory: string;
  clientDisplayId: string;
  assignedToId: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  daysRemaining: number | null;
  daysOverdue: number;
  /** Transitions the state machine permits from the current status. */
  allowedTransitions: TaskStatus[];
  comments: TaskComment[];
  history: TaskHistoryEntry[];
}

export async function getTaskDetail(
  ctx: OrgContext,
  taskId: string,
  today: Date = new Date(),
): Promise<TaskDetail | null> {
  const row = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      ...taskSelect,
      description: true,
      notes: true,
      waitingFor: true,
      clientDependency: true,
      startDate: true,
      taskCategory: true,
      assignedToId: true,
      reviewerId: true,
      reviewer: { select: { user: { select: { name: true } } } },
      client: { select: { name: true, displayId: true } },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          authorId: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      },
      statusHistory: {
        orderBy: { changedAt: "desc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          changedAt: true,
          changedById: true,
        },
      },
    },
  });
  if (!row) return null;

  const task = toDomainTask(row);

  // Resolve the members who made status changes, in one query rather than
  // one per history row.
  const changerIds = [
    ...new Set(
      row.statusHistory
        .map((entry) => entry.changedById)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const changers =
    changerIds.length > 0
      ? await prisma.organizationMember.findMany({
          where: { id: { in: changerIds }, organizationId: ctx.organizationId },
          select: { id: true, user: { select: { name: true } } },
        })
      : [];
  const changerName = new Map(
    changers.map((member) => [member.id, member.user.name]),
  );

  return {
    task,
    description: row.description,
    notes: row.notes,
    waitingFor: row.waitingFor,
    clientDependency: row.clientDependency,
    startDate: row.startDate,
    taskCategory: row.taskCategory,
    clientDisplayId: row.client.displayId,
    assignedToId: row.assignedToId,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewer?.user.name ?? null,
    daysRemaining: computeDaysRemaining(task.dueDate, task.status, today),
    daysOverdue: computeDaysOverdue(task.dueDate, task.status, today),
    // The UI offers only these, so a user is never shown a move the server
    // would refuse (legacy reverted an invalid edit with a toast instead).
    allowedTransitions: Object.values(TaskStatus).filter(
      (candidate) =>
        candidate !== task.status && nextStatusAllowed(task.status, candidate),
    ),
    comments: row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      authorName: comment.author?.name ?? null,
      createdAt: comment.createdAt,
    })),
    history: row.statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedAt: entry.changedAt,
      changedByName: entry.changedById
        ? (changerName.get(entry.changedById) ?? null)
        : null,
    })),
  };
}

/** Select options for the task forms and filters, always org-scoped. */
export async function getTaskFormOptions(ctx: OrgContext) {
  const [clients, members, serviceAreas, periods] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, displayId: true },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      distinct: ["serviceArea"],
      orderBy: { serviceArea: "asc" },
      select: { serviceArea: true },
    }),
    prisma.task.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        period: { not: null },
      },
      distinct: ["period"],
      orderBy: { period: "desc" },
      select: { period: true },
      take: 24,
    }),
  ]);

  return {
    clients,
    members: members.map((m) => ({ id: m.id, name: m.user.name })),
    serviceAreas: serviceAreas.map((row) => row.serviceArea).filter(Boolean),
    periods: periods
      .map((row) => row.period)
      .filter((period): period is string => Boolean(period)),
  };
}
