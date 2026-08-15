/**
 * Client Dashboard.
 *
 * Port of legacy `apps-script/dashboards/ClientDashboardEngine.gs`
 * (audit §8.4) — the seven summary cards, per-service-area progress, open
 * work, and upcoming deadlines.
 */

import { computeDaysOverdue, computeDaysRemaining } from "@/lib/domain/date";
import { TaskStatus } from "@/lib/domain/enums";
import { computeSimpleCompletion } from "@/lib/domain/progress";
import { isTaskOpen } from "@/lib/domain/task";
import type { DomainTask } from "@/lib/domain/types";

export interface ClientTaskSummary {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  waitingClient: number;
  blocked: number;
  overdue: number;
}

export interface ServiceAreaProgress {
  serviceArea: string;
  completionPct: number;
}

export interface UpcomingDeadline {
  taskId: string;
  taskName: string;
  dueDate: Date;
  daysRemaining: number | null;
}

/**
 * Legacy `writeTaskSummaryCards` — the seven counts.
 *
 * Cancelled tasks are excluded from all seven, so a client is not shown work
 * that was called off.
 */
export function buildClientTaskSummary(
  tasks: readonly DomainTask[],
  today: Date,
): ClientTaskSummary {
  const counted = tasks.filter((t) => t.status !== TaskStatus.CANCELLED);

  return {
    total: counted.length,
    completed: counted.filter((t) => t.status === TaskStatus.COMPLETED).length,
    inProgress: counted.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
    notStarted: counted.filter((t) => t.status === TaskStatus.NOT_STARTED).length,
    waitingClient: counted.filter((t) => t.status === TaskStatus.WAITING_CLIENT)
      .length,
    blocked: counted.filter((t) => t.status === TaskStatus.BLOCKED).length,
    overdue: counted.filter(
      (t) => computeDaysOverdue(t.dueDate, t.status, today) > 0,
    ).length,
  };
}

/**
 * Legacy `writeServiceProgressTable` — completion per service area,
 * alphabetically. An unset area groups under "Unspecified", as legacy did,
 * rather than being dropped.
 */
export function buildServiceAreaProgress(
  tasks: readonly DomainTask[],
): ServiceAreaProgress[] {
  const byArea = new Map<string, DomainTask[]>();

  for (const task of tasks) {
    if (task.status === TaskStatus.CANCELLED) continue;
    const area = task.serviceArea || "Unspecified";
    const existing = byArea.get(area);
    if (existing) existing.push(task);
    else byArea.set(area, [task]);
  }

  return [...byArea.keys()]
    .sort()
    .map((serviceArea) => ({
      serviceArea,
      completionPct: computeSimpleCompletion(byArea.get(serviceArea) ?? []).pct,
    }));
}

/**
 * Legacy `writeUpcomingDeadlinesTable` — open tasks that have a due date,
 * soonest first, capped by the caller.
 */
export function buildUpcomingDeadlines(
  tasks: readonly DomainTask[],
  today: Date,
  limit = 10,
): UpcomingDeadline[] {
  return tasks
    .filter((task) => isTaskOpen(task.status) && task.dueDate !== null)
    .sort(
      (a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime(),
    )
    .slice(0, limit)
    .map((task) => ({
      taskId: task.id,
      taskName: task.taskName,
      dueDate: task.dueDate as Date,
      daysRemaining: computeDaysRemaining(task.dueDate, task.status, today),
    }));
}
