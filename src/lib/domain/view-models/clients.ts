/**
 * Clients list and detail view models.
 *
 * Port of legacy `apps-script/webapp/ClientsViewModelLogic.gs`.
 *
 * Per-client scoping mirrors the legacy Client Dashboard precedent exactly:
 * the Tasks, Issues, and Requests sections show only OPEN items. A client
 * detail view is a working view — what is outstanding — not an archive.
 */

import { computeDaysRemaining } from "@/lib/domain/date";
import type { ClientHealth, ContractStatus } from "@/lib/domain/enums";
import { compareByHealthThenName } from "@/lib/domain/health";
import { isIssueOpen, issueSeverityRank } from "@/lib/domain/issue";
import { isRequestOpen, requestDaysWaiting } from "@/lib/domain/request";
import { bucketDaysWaiting } from "@/lib/domain/date";
import { isTaskOpen } from "@/lib/domain/task";
import type {
  DomainClient,
  DomainIssue,
  DomainRequest,
  DomainTask,
} from "@/lib/domain/types";
import type { DaysWaitingBucket } from "@/lib/domain/enums";

export interface ClientListRow {
  clientId: string;
  clientDisplayId: string;
  clientName: string;
  servicePackage: string | null;
  accountManager: string | null;
  contractStatus: ContractStatus;
  health: ClientHealth;
  completionPct: number;
  nextDeadline: Date | null;
}

export interface ClientDetailTaskRow {
  taskId: string;
  taskDisplayId: string;
  taskName: string;
  serviceArea: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  dueDate: Date | null;
  daysRemaining: number | null;
  reviewStatus: string;
}

export interface ClientDetailIssueRow {
  issueId: string;
  issueDisplayId: string;
  title: string;
  category: string | null;
  severity: string;
  status: string;
  owner: string | null;
  dateRaised: Date | null;
  deadline: Date | null;
  requiredAction: string | null;
}

export interface ClientDetailRequestRow {
  requestId: string;
  requestDisplayId: string;
  title: string;
  status: string;
  requestedDate: Date | null;
  requiredBy: Date | null;
  daysWaiting: number | null;
  daysWaitingBucket: DaysWaitingBucket | null;
  assignedTo: string | null;
}

export interface ClientDetailViewModel {
  clientId: string;
  clientDisplayId: string;
  clientName: string;
  companyName: string | null;
  industry: string | null;
  businessType: string | null;
  servicePackage: string | null;
  accountManager: string | null;
  backupTeamMember: string | null;
  clientContact: string | null;
  email: string | null;
  phone: string | null;
  contractStatus: ContractStatus;
  priority: string;
  health: ClientHealth;
  simpleCompletionPct: number;
  weightedCompletionPct: number;
  lastActivity: Date | null;
  nextDeadline: Date | null;
  notes: string | null;
  tasks: ClientDetailTaskRow[];
  issues: ClientDetailIssueRow[];
  requests: ClientDetailRequestRow[];
}

/**
 * Legacy `buildClientsListViewModel` — ALL clients, not just Active, since
 * the Clients page has its own status filters. Default-sorted most urgent
 * health first, then alphabetically.
 */
export function buildClientsListViewModel(
  clients: readonly DomainClient[],
): ClientListRow[] {
  const rows = clients.map((client) => ({
    clientId: client.id,
    clientDisplayId: client.displayId,
    clientName: client.name,
    servicePackage: client.servicePackageName,
    accountManager: client.accountManagerName,
    contractStatus: client.contractStatus,
    health: client.health,
    completionPct: Number(client.weightedCompletionPct) || 0,
    nextDeadline: client.nextDeadline,
  }));

  return rows.sort(compareByHealthThenName);
}

/** Sort key placing tasks with no due date LAST — a missing date is not urgent. */
export function taskDueDateSortKey(dueDate: Date | null): number {
  return dueDate ? dueDate.getTime() : Number.POSITIVE_INFINITY;
}

/** Legacy `buildClientDetailTaskRows` — open tasks, soonest due first. */
export function buildClientDetailTaskRows(
  tasks: readonly DomainTask[],
  today: Date,
): ClientDetailTaskRow[] {
  const rows = tasks.map((task) => ({
    taskId: task.id,
    taskDisplayId: task.displayId,
    taskName: task.taskName,
    serviceArea: task.serviceArea,
    status: task.status,
    priority: task.priority,
    assignedTo: task.assignedToName,
    dueDate: task.dueDate,
    daysRemaining: computeDaysRemaining(task.dueDate, task.status, today),
    reviewStatus: task.reviewStatus,
  }));

  return rows.sort(
    (a, b) => taskDueDateSortKey(a.dueDate) - taskDueDateSortKey(b.dueDate),
  );
}

/** Legacy `buildClientDetailIssueRows` — open issues, most severe first. */
export function buildClientDetailIssueRows(
  issues: readonly DomainIssue[],
): ClientDetailIssueRow[] {
  const rows = issues.map((issue) => ({
    issueId: issue.id,
    issueDisplayId: issue.displayId,
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    status: issue.status,
    owner: issue.assignedToName,
    dateRaised: issue.dateRaised,
    deadline: issue.deadline,
    requiredAction: issue.requiredAction,
  }));

  return rows.sort(
    (a, b) => issueSeverityRank(b.severity) - issueSeverityRank(a.severity),
  );
}

/**
 * Legacy `buildClientDetailRequestRows` — open requests, longest-waiting
 * first, so the thing that has been outstanding longest is at the top.
 */
export function buildClientDetailRequestRows(
  requests: readonly DomainRequest[],
  today: Date,
): ClientDetailRequestRow[] {
  const rows = requests.map((request) => {
    const daysWaiting = requestDaysWaiting(request, today);
    return {
      requestId: request.id,
      requestDisplayId: request.displayId,
      title: request.title,
      status: request.status,
      requestedDate: request.requestedDate,
      requiredBy: request.requiredBy,
      daysWaiting,
      daysWaitingBucket: bucketDaysWaiting(daysWaiting),
      assignedTo: request.assignedToName,
    };
  });

  // Legacy sorted on `(b.daysWaiting || 0) - (a.daysWaiting || 0)`, so a null
  // sorts as zero — last among positives. Preserved.
  return rows.sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
}

/**
 * Legacy `buildClientDetailViewModel`. Returns null when the client does not
 * exist, which the caller renders as a not-found state.
 *
 * Health and both completion percentages are READ from the client record,
 * not recomputed — same reasoning as the Control Center: one engine owns
 * them, and a second calculation here could disagree with the list the user
 * just came from.
 */
export function buildClientDetailViewModel(
  clientId: string,
  clients: readonly DomainClient[],
  tasks: readonly DomainTask[],
  issues: readonly DomainIssue[],
  requests: readonly DomainRequest[],
  today: Date,
): ClientDetailViewModel | null {
  const client = clients.find((c) => c.id === clientId);
  if (!client) return null;

  const openTasks = tasks.filter(
    (t) => t.clientId === clientId && isTaskOpen(t.status),
  );
  const openIssues = issues.filter(
    (i) => i.clientId === clientId && isIssueOpen(i.status),
  );
  const openRequests = requests.filter(
    (r) => r.clientId === clientId && isRequestOpen(r.status),
  );

  return {
    clientId: client.id,
    clientDisplayId: client.displayId,
    clientName: client.name,
    companyName: client.companyName,
    industry: client.industry,
    businessType: client.businessType,
    servicePackage: client.servicePackageName,
    accountManager: client.accountManagerName,
    backupTeamMember: client.backupMemberName,
    clientContact: client.contactName,
    email: client.email,
    phone: client.phone,
    contractStatus: client.contractStatus,
    priority: client.priority,
    health: client.health,
    simpleCompletionPct: Number(client.simpleCompletionPct) || 0,
    weightedCompletionPct: Number(client.weightedCompletionPct) || 0,
    lastActivity: client.lastActivityAt,
    nextDeadline: client.nextDeadline,
    notes: client.notes,
    tasks: buildClientDetailTaskRows(openTasks, today),
    issues: buildClientDetailIssueRows(openIssues),
    requests: buildClientDetailRequestRows(openRequests, today),
  };
}
