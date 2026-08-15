/**
 * Team Dashboard.
 *
 * Port of legacy `apps-script/dashboards/TeamDashboardEngine.gs` (audit §8.5).
 * Legacy kept this logic in the IO layer rather than a `*Logic.gs` module;
 * extracting it here is exactly the seam the audit describes — the rules move,
 * only the sheet writing is dropped.
 */

import { computeDaysOverdue } from "@/lib/domain/date";
import { Priority, TaskStatus } from "@/lib/domain/enums";
import { computeSimpleCompletion } from "@/lib/domain/progress";
import { isTaskOpen } from "@/lib/domain/task";
import type { DomainMember, DomainTask } from "@/lib/domain/types";
import { isOverloaded } from "@/lib/domain/workload";

export interface TeamDashboardRow {
  memberId: string;
  memberName: string;
  jobTitle: string | null;
  assigned: number;
  completed: number;
  inProgress: number;
  overdue: number;
  waitingClient: number;
  /** Open Critical tasks only — a completed critical task is not a live risk. */
  critical: number;
  completionPct: number;
  capacity: number | null;
  overloaded: boolean;
}

/**
 * Legacy `renderTeamDashboard`, one row per member.
 *
 * Cancelled tasks are excluded from every count, matching the shared
 * `computeSimpleCompletion` population, so a member is not penalised for work
 * that was called off.
 */
export function buildTeamDashboardRows(
  members: readonly DomainMember[],
  tasks: readonly DomainTask[],
  today: Date,
  overloadMargin = 0,
): TeamDashboardRow[] {
  return members.map((member) => {
    const assignedTasks = tasks.filter(
      (task) => task.assignedToName === member.name,
    );
    const counted = assignedTasks.filter(
      (task) => task.status !== TaskStatus.CANCELLED,
    );
    const openTasks = counted.filter((task) => isTaskOpen(task.status));

    return {
      memberId: member.id,
      memberName: member.name,
      jobTitle: member.jobTitle,
      assigned: counted.length,
      completed: counted.filter((t) => t.status === TaskStatus.COMPLETED).length,
      inProgress: counted.filter((t) => t.status === TaskStatus.IN_PROGRESS)
        .length,
      overdue: counted.filter(
        (t) => computeDaysOverdue(t.dueDate, t.status, today) > 0,
      ).length,
      waitingClient: counted.filter(
        (t) => t.status === TaskStatus.WAITING_CLIENT,
      ).length,
      critical: openTasks.filter((t) => t.priority === Priority.CRITICAL).length,
      completionPct: computeSimpleCompletion(counted).pct,
      capacity: member.capacity,
      overloaded: isOverloaded(openTasks.length, member.capacity, overloadMargin),
    };
  });
}
