/**
 * Management Report.
 *
 * Port of legacy `apps-script/dashboards/ManagementReportLogic.gs`
 * (audit §8.6) — four sections answering "what should management look at
 * this month?".
 */

import { computeDaysOverdue } from "@/lib/domain/date";
import {
  ClientHealth,
  IssueSeverity,
  TaskStatus,
} from "@/lib/domain/enums";
import { isIssueOpen } from "@/lib/domain/issue";
import { computeSimpleCompletion } from "@/lib/domain/progress";
import { flagStaleRequests, isRequestOpen } from "@/lib/domain/request";
import { taskBelongsToMember } from "@/lib/domain/task";
import type {
  DomainClient,
  DomainIssue,
  DomainMember,
  DomainRequest,
  DomainTask,
} from "@/lib/domain/types";

export interface ClientPerformanceSection {
  /** On Track clients, best weighted completion first. */
  best: string[];
  atRisk: string[];
  delayed: string[];
  onHold: string[];
}

export interface TeamPerformanceRow {
  member: string;
  tasks: number;
  completed: number;
  overdue: number;
  completionPct: number;
}

export interface OperationalRisksSection {
  overdueTasks: number;
  criticalIssues: number;
  blockedTasks: number;
  outstandingRequests: number;
}

export interface AttentionItem {
  type: "Client Delayed" | "Critical Issue" | "Blocked Task" | "Stale Request";
  label: string;
}

export interface ManagementReport {
  clientPerformance: ClientPerformanceSection;
  teamPerformance: TeamPerformanceRow[];
  operationalRisks: OperationalRisksSection;
  managementAttention: AttentionItem[];
}

/** Legacy cap on the attention list — a list nobody finishes reading is not a list. */
export const MANAGEMENT_ATTENTION_LIMIT = 15;

/** Legacy `buildClientPerformanceSection`. */
export function buildClientPerformanceSection(
  clients: readonly DomainClient[],
): ClientPerformanceSection {
  const byHealth = (health: ClientHealth) =>
    clients.filter((client) => client.health === health);

  const byProgressDesc = (a: DomainClient, b: DomainClient) =>
    (b.weightedCompletionPct || 0) - (a.weightedCompletionPct || 0);

  return {
    best: [...byHealth(ClientHealth.ON_TRACK)]
      .sort(byProgressDesc)
      .map((client) => client.name),
    atRisk: byHealth(ClientHealth.AT_RISK).map((client) => client.name),
    delayed: byHealth(ClientHealth.DELAYED).map((client) => client.name),
    onHold: byHealth(ClientHealth.ON_HOLD).map((client) => client.name),
  };
}

/** Legacy `buildTeamPerformanceSection`. */
export function buildTeamPerformanceSection(
  tasks: readonly DomainTask[],
  members: readonly DomainMember[],
  today: Date,
): TeamPerformanceRow[] {
  return members.map((member) => {
    const memberTasks = tasks.filter(
      (task) =>
        taskBelongsToMember(task, member) &&
        task.status !== TaskStatus.CANCELLED,
    );
    const completion = computeSimpleCompletion(memberTasks);

    return {
      member: member.name,
      tasks: completion.total,
      completed: completion.completed,
      overdue: memberTasks.filter(
        (task) => computeDaysOverdue(task.dueDate, task.status, today) > 0,
      ).length,
      completionPct: completion.pct,
    };
  });
}

/**
 * Legacy `buildOperationalRisksSection`.
 *
 * Note `overdueTasks` and `blockedTasks` count over ALL tasks here, including
 * cancelled ones for the blocked count — legacy filtered neither. Preserved
 * as-is; a cancelled task cannot be Blocked in practice, so the distinction
 * is theoretical.
 */
export function buildOperationalRisksSection(
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  requests: readonly DomainRequest[],
  today: Date,
): OperationalRisksSection {
  return {
    overdueTasks: tasks.filter(
      (task) => computeDaysOverdue(task.dueDate, task.status, today) > 0,
    ).length,
    criticalIssues: issues.filter(
      (issue) =>
        isIssueOpen(issue.status) && issue.severity === IssueSeverity.CRITICAL,
    ).length,
    blockedTasks: tasks.filter((task) => task.status === TaskStatus.BLOCKED)
      .length,
    outstandingRequests: requests.filter((request) =>
      isRequestOpen(request.status),
    ).length,
  };
}

/**
 * Legacy `buildManagementAttentionSection`.
 *
 * Ordering is by CATEGORY, not by severity within a mixed list:
 * Delayed clients → Critical issues → Blocked tasks → Stale requests,
 * capped at 15. A delayed client outranks any single issue because it is the
 * aggregate signal; the categories below it are the specific causes.
 */
export function buildManagementAttentionSection(
  clients: readonly DomainClient[],
  issues: readonly DomainIssue[],
  tasks: readonly DomainTask[],
  requests: readonly DomainRequest[],
  staleDaysThreshold: number,
  today: Date,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const client of clients) {
    if (client.health === ClientHealth.DELAYED) {
      items.push({ type: "Client Delayed", label: client.name });
    }
  }

  for (const issue of issues) {
    if (isIssueOpen(issue.status) && issue.severity === IssueSeverity.CRITICAL) {
      items.push({
        type: "Critical Issue",
        label: `${issue.title} (${issue.clientName})`,
      });
    }
  }

  for (const task of tasks) {
    if (task.status === TaskStatus.BLOCKED) {
      items.push({
        type: "Blocked Task",
        label: `${task.taskName} (${task.clientName})`,
      });
    }
  }

  const openRequests = requests.filter((request) =>
    isRequestOpen(request.status),
  );
  const staleIds = new Set(
    flagStaleRequests(openRequests, staleDaysThreshold, today),
  );
  for (const request of requests) {
    if (staleIds.has(request.id)) {
      items.push({
        type: "Stale Request",
        label: `${request.title} (${request.clientName})`,
      });
    }
  }

  return items.slice(0, MANAGEMENT_ATTENTION_LIMIT);
}

/** Legacy `buildManagementReport`. */
export function buildManagementReport(
  clients: readonly DomainClient[],
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  requests: readonly DomainRequest[],
  members: readonly DomainMember[],
  staleDaysThreshold: number,
  today: Date,
): ManagementReport {
  return {
    clientPerformance: buildClientPerformanceSection(clients),
    teamPerformance: buildTeamPerformanceSection(tasks, members, today),
    operationalRisks: buildOperationalRisksSection(
      tasks,
      issues,
      requests,
      today,
    ),
    managementAttention: buildManagementAttentionSection(
      clients,
      issues,
      tasks,
      requests,
      staleDaysThreshold,
      today,
    ),
  };
}
