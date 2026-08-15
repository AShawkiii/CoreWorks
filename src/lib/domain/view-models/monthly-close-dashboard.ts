/**
 * Monthly Close Dashboard.
 *
 * Port of legacy `apps-script/dashboards/MonthlyCloseDashboardEngine.gs`
 * (audit §8, §6.13).
 *
 * The summary counts span EVERY task for the client in that period — not only
 * tasks tagged `Service Area = "Month-End Closing"`. Legacy is explicit about
 * this: "the close" is everything due that period, so scoping the summary to
 * the close service area would understate what is actually outstanding.
 *
 * That makes two distinct completion numbers on this screen, deliberately:
 *  - `completionPct` here is TASK-based (all tasks for the period);
 *  - `MonthlyClose.completionPct` is STAGE-based (the 18 close stages).
 * They answer different questions and are not interchangeable.
 */

import { computeDaysOverdue } from "@/lib/domain/date";
import { TaskStatus } from "@/lib/domain/enums";
import { computeSimpleCompletion } from "@/lib/domain/progress";
import { isTaskOpen } from "@/lib/domain/task";
import type { DomainCloseStage, DomainTask } from "@/lib/domain/types";

export interface MonthlyCloseSummary {
  /** Task-based completion for the period. */
  completionPct: number;
  completed: number;
  /** Open, and neither blocked nor waiting on the client. */
  pending: number;
  overdue: number;
  waitingClient: number;
  blocked: number;
}

/**
 * Legacy `renderMonthlyCloseDashboard`'s summary block.
 *
 * `pending` deliberately excludes Blocked and Waiting Client: those have their
 * own cards, and counting them again as "pending" would double-report the
 * same work and hide that it is stuck rather than merely unstarted.
 */
export function buildMonthlyCloseSummary(
  periodTasks: readonly DomainTask[],
  today: Date,
): MonthlyCloseSummary {
  const counted = periodTasks.filter(
    (task) => task.status !== TaskStatus.CANCELLED,
  );

  return {
    completionPct: computeSimpleCompletion(counted).pct,
    completed: counted.filter((t) => t.status === TaskStatus.COMPLETED).length,
    pending: counted.filter(
      (t) =>
        isTaskOpen(t.status) &&
        t.status !== TaskStatus.BLOCKED &&
        t.status !== TaskStatus.WAITING_CLIENT,
    ).length,
    overdue: counted.filter(
      (t) => computeDaysOverdue(t.dueDate, t.status, today) > 0,
    ).length,
    waitingClient: counted.filter((t) => t.status === TaskStatus.WAITING_CLIENT)
      .length,
    blocked: counted.filter((t) => t.status === TaskStatus.BLOCKED).length,
  };
}

/** Stage values in legacy column order, for the stage strip. */
export function orderStages(
  stages: readonly DomainCloseStage[],
): DomainCloseStage[] {
  return [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
}
