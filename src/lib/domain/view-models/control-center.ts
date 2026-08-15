/**
 * Control Center view model.
 *
 * Port of legacy `apps-script/webapp/ControlCenterViewModelLogic.gs`
 * (audit §8.2).
 *
 * The audit establishes that TWO Control Center implementations existed: the
 * spreadsheet's 9 live-formula KPIs, and the Web App's 14. The CoreWorks
 * brief's §16 list matches the Web App's fourteen exactly, so that is the one
 * migrated — confirmed key by key below.
 *
 * Legacy reused existing rules here rather than re-deriving them, and so does
 * this port:
 *  - health is READ from the client record (computed by the health engine),
 *    not recomputed;
 *  - completion is READ from the client's stored weighted percentage;
 *  - overdue-ness uses the shared `computeDaysOverdue`;
 *  - surfaced issues call `selectSurfacedIssues` — the same function, not a
 *    parallel ranking.
 */

import { computeDaysOverdue, daysBetween } from "@/lib/domain/date";
import {
  ClientHealth,
  ContractStatus,
  TaskStatus,
} from "@/lib/domain/enums";
import { compareByHealthThenName } from "@/lib/domain/health";
import { isIssueOpen, selectSurfacedIssues } from "@/lib/domain/issue";
import { isTaskOpen } from "@/lib/domain/task";
import type {
  DomainClient,
  DomainIssue,
  DomainTask,
} from "@/lib/domain/types";

export type KpiFormat = "count" | "percent";

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: KpiFormat;
}

export interface ClientHealthRow {
  clientId: string;
  clientDisplayId: string;
  clientName: string;
  servicePackage: string | null;
  accountManager: string | null;
  health: ClientHealth;
  completionPct: number;
  overdueTasks: number;
  waitingOnClient: number;
  openIssues: number;
  nextDeadline: Date | null;
}

export interface SurfacedIssueRow {
  issueId: string;
  issueDisplayId: string;
  clientId: string;
  clientName: string;
  title: string;
  severity: string;
  status: string;
  owner: string | null;
  daysOpen: number | null;
  deadline: Date | null;
}

export interface ControlCenterViewModel {
  kpis: Kpi[];
  clientHealth: ClientHealthRow[];
  surfacedIssues: SurfacedIssueRow[];
  generatedAt: Date;
}

/** Legacy `groupRowsByClientId`. */
export function groupByClientId<T extends { clientId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.clientId);
    if (existing) existing.push(row);
    else grouped.set(row.clientId, [row]);
  }
  return grouped;
}

/**
 * Legacy `buildControlCenterKpis` — the fourteen, in order.
 *
 * Two behaviours are preserved deliberately, both documented in the audit:
 *
 * 1. **Task KPIs are unscoped by client contract status.** They count across
 *    every client, matching the spreadsheet's COUNTIF formulas. Scoping them
 *    to Active clients would make the Control Center disagree with the sheet
 *    it replaces.
 *
 * 2. **Overall Completion % is a plain MEAN of per-client percentages**, not
 *    a task-weighted global figure. A three-task client and a three-hundred-
 *    task client contribute equally. That is a real modelling choice, flagged
 *    in audit §8.2 for product review — preserved here rather than quietly
 *    "improved", since changing it would move a number management tracks.
 */
export function buildControlCenterKpis(
  clients: readonly DomainClient[],
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  today: Date,
): Kpi[] {
  const activeClients = clients.filter(
    (c) => c.contractStatus === ContractStatus.ACTIVE,
  );
  const onboardingClients = clients.filter(
    (c) => c.contractStatus === ContractStatus.ONBOARDING,
  );
  const onHoldClients = clients.filter(
    (c) => c.contractStatus === ContractStatus.ON_HOLD,
  );
  const atRiskClients = clients.filter(
    (c) => c.health === ClientHealth.AT_RISK,
  );
  const delayedClients = clients.filter(
    (c) => c.health === ClientHealth.DELAYED,
  );

  const countedTasks = tasks.filter((t) => t.status !== TaskStatus.CANCELLED);
  const openTasks = countedTasks.filter((t) => isTaskOpen(t.status));
  const overdueTasks = countedTasks.filter(
    (t) => computeDaysOverdue(t.dueDate, t.status, today) > 0,
  );
  const completedTasks = countedTasks.filter(
    (t) => t.status === TaskStatus.COMPLETED,
  );
  const waitingClientTasks = countedTasks.filter(
    (t) => t.status === TaskStatus.WAITING_CLIENT,
  );
  const blockedTasks = countedTasks.filter(
    (t) => t.status === TaskStatus.BLOCKED,
  );

  const openIssues = issues.filter((i) => isIssueOpen(i.status));
  const attentionIssues = selectSurfacedIssues(issues, today);

  const completionValues = clients.map(
    (c) => Number(c.weightedCompletionPct) || 0,
  );
  const overallCompletionPct =
    completionValues.length === 0
      ? 0
      : completionValues.reduce((a, b) => a + b, 0) / completionValues.length;

  return [
    { key: "totalClients", label: "Total Clients", value: clients.length, format: "count" },
    { key: "activeClients", label: "Active Clients", value: activeClients.length, format: "count" },
    { key: "onboardingClients", label: "Onboarding", value: onboardingClients.length, format: "count" },
    { key: "onHoldClients", label: "On Hold", value: onHoldClients.length, format: "count" },
    { key: "clientsAtRisk", label: "Clients At Risk", value: atRiskClients.length, format: "count" },
    { key: "clientsDelayed", label: "Clients Delayed", value: delayedClients.length, format: "count" },
    { key: "overallCompletionPct", label: "Overall Completion %", value: overallCompletionPct, format: "percent" },
    { key: "openTasks", label: "Open Tasks", value: openTasks.length, format: "count" },
    { key: "overdueTasks", label: "Overdue Tasks", value: overdueTasks.length, format: "count" },
    { key: "tasksCompleted", label: "Tasks Completed", value: completedTasks.length, format: "count" },
    { key: "waitingOnClient", label: "Waiting on Client", value: waitingClientTasks.length, format: "count" },
    { key: "blockedTasks", label: "Blocked Tasks", value: blockedTasks.length, format: "count" },
    { key: "openIssues", label: "Open Issues", value: openIssues.length, format: "count" },
    { key: "issuesNeedingAttention", label: "Issues Needing Attention", value: attentionIssues.length, format: "count" },
  ];
}

/**
 * Legacy `buildClientHealthRows` — one row per ACTIVE client.
 *
 * The Active-only filter is legacy behaviour and is preserved (audit conflict
 * C5): the health table shows the live roster, while On Hold and Onboarding
 * clients are represented by their own KPI cards. The CoreWorks brief's §17
 * does not mention the filter, so it is flagged rather than assumed.
 *
 * Sorted most-urgent-health first, then alphabetically.
 */
export function buildClientHealthRows(
  clients: readonly DomainClient[],
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  today: Date,
): ClientHealthRow[] {
  const tasksByClient = groupByClientId(tasks);
  const issuesByClient = groupByClientId(issues);

  const rows = clients
    .filter((client) => client.contractStatus === ContractStatus.ACTIVE)
    .map((client) => {
      const clientTasks = tasksByClient.get(client.id) ?? [];
      const clientIssues = issuesByClient.get(client.id) ?? [];

      return {
        clientId: client.id,
        clientDisplayId: client.displayId,
        clientName: client.name,
        servicePackage: client.servicePackageName,
        accountManager: client.accountManagerName,
        health: client.health,
        completionPct: Number(client.weightedCompletionPct) || 0,
        overdueTasks: clientTasks.filter(
          (t) => computeDaysOverdue(t.dueDate, t.status, today) > 0,
        ).length,
        waitingOnClient: clientTasks.filter(
          (t) => t.status === TaskStatus.WAITING_CLIENT,
        ).length,
        openIssues: clientIssues.filter((i) => isIssueOpen(i.status)).length,
        nextDeadline: client.nextDeadline,
      };
    });

  return rows.sort(compareByHealthThenName);
}

/** Legacy `buildSurfacedIssueRows` — reuses `selectSurfacedIssues` verbatim. */
export function buildSurfacedIssueRows(
  issues: readonly DomainIssue[],
  today: Date,
): SurfacedIssueRow[] {
  return selectSurfacedIssues(issues, today).map((issue) => ({
    issueId: issue.id,
    issueDisplayId: issue.displayId,
    clientId: issue.clientId,
    clientName: issue.clientName,
    title: issue.title,
    severity: issue.severity,
    status: issue.status,
    owner: issue.assignedToName,
    daysOpen: issue.dateRaised ? daysBetween(today, issue.dateRaised) : null,
    deadline: issue.deadline,
  }));
}

/** Legacy `buildControlCenterViewModel`. */
export function buildControlCenterViewModel(
  clients: readonly DomainClient[],
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  today: Date,
): ControlCenterViewModel {
  return {
    kpis: buildControlCenterKpis(clients, tasks, issues, today),
    clientHealth: buildClientHealthRows(clients, tasks, issues, today),
    surfacedIssues: buildSurfacedIssueRows(issues, today),
    generatedAt: today,
  };
}
