import {
  ClientHealth,
  ContractStatus,
  Frequency,
  IssueSeverity,
  IssueStatus,
  Priority,
  RequestStatus,
  ReviewStatus,
  TaskStatus,
} from "@/lib/domain/enums";
import type {
  DomainClient,
  DomainIssue,
  DomainMember,
  DomainRequest,
  DomainTask,
} from "@/lib/domain/types";

/**
 * Fixture builders that project the SAME record into both worlds.
 *
 * Each builder produces a domain record; `toLegacy*` renders that identical
 * record as the spreadsheet row object the legacy functions expect. Because
 * both sides come from one source, a parity failure can only mean the logic
 * differs — never that the two inputs drifted.
 */

/** Legacy compared statuses as display strings; these are the same values. */
export const TASK_STATUS_TO_LEGACY: Record<TaskStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  WAITING_CLIENT: "Waiting Client",
  BLOCKED: "Blocked",
  IN_REVIEW: "In Review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PRIORITY_TO_LEGACY: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const HEALTH_TO_LEGACY: Record<ClientHealth, string> = {
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  DELAYED: "Delayed",
  ON_HOLD: "On Hold",
};

export const CONTRACT_TO_LEGACY: Record<ContractStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ISSUE_STATUS_TO_LEGACY: Record<IssueStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const SEVERITY_TO_LEGACY: Record<IssueSeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const REQUEST_STATUS_TO_LEGACY: Record<RequestStatus, string> = {
  REQUESTED: "Requested",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  NOT_AVAILABLE: "Not Available",
  CANCELLED: "Cancelled",
};

export const FREQUENCY_TO_LEGACY: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
  ONE_TIME: "One-Time",
};

/**
 * Legacy represented an absent date as `''`. Dates are passed as real Date
 * objects so both sides see the identical instant — legacy's own tests used
 * ISO strings, which `new Date()` parses as UTC midnight and can shift a day
 * under a non-UTC local timezone.
 */
export function toLegacyDate(date: Date | null): Date | "" {
  return date ?? "";
}

export function d(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  // Local midnight, matching how the domain treats calendar days.
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
}

let counter = 0;
const nextId = () => `id-${++counter}`;

/**
 * Display ids default to unique values.
 *
 * They must be: legacy `buildManagementAttentionSection` matches stale
 * requests with `staleIds.indexOf(row['Request ID'])`, so two fixture rows
 * sharing an id would both match and the comparison would diverge for a
 * reason that has nothing to do with the rule under test.
 */
const nextDisplayId = (prefix: string, width: number) =>
  `${prefix}${String(counter).padStart(width, "0")}`;

export function makeTask(overrides: Partial<DomainTask> = {}): DomainTask {
  return {
    id: nextId(),
    displayId: nextDisplayId("TSK-", 6),
    clientId: "client-1",
    clientName: "Acme Co",
    serviceArea: "Bookkeeping",
    taskName: "Daily Bookkeeping",
    period: "2026-08",
    frequency: Frequency.MONTHLY,
    assignedToName: "Jane AM",
    priority: Priority.MEDIUM,
    status: TaskStatus.NOT_STARTED,
    dueDate: null,
    completionDate: null,
    completionPct: 0,
    reviewStatus: ReviewStatus.NOT_REVIEWED,
    ...overrides,
  };
}

export function toLegacyTask(task: DomainTask): Record<string, unknown> {
  return {
    "Task ID": task.displayId,
    "Client ID": task.clientId,
    "Client Name": task.clientName,
    "Service Area": task.serviceArea,
    "Task Name": task.taskName,
    Period: task.period ?? "",
    Frequency: task.frequency ? FREQUENCY_TO_LEGACY[task.frequency] : "",
    "Assigned To": task.assignedToName ?? "",
    Priority: PRIORITY_TO_LEGACY[task.priority],
    Status: TASK_STATUS_TO_LEGACY[task.status],
    "Due Date": toLegacyDate(task.dueDate),
    "Completion Date": toLegacyDate(task.completionDate),
    "Completion %": task.completionPct,
    "Review Status": task.reviewStatus,
  };
}

export function makeClient(overrides: Partial<DomainClient> = {}): DomainClient {
  return {
    id: "client-1",
    displayId: "CL-0001",
    name: "Acme Co",
    companyName: "Acme Co Ltd",
    industry: "Retail",
    businessType: "Limited Company",
    servicePackageName: "Basic Accounting",
    accountManagerName: "Jane AM",
    backupMemberName: null,
    contactName: "Finance Contact",
    email: "finance@acme.example.com",
    phone: null,
    contractStatus: ContractStatus.ACTIVE,
    priority: Priority.MEDIUM,
    health: ClientHealth.ON_TRACK,
    simpleCompletionPct: 0.5,
    weightedCompletionPct: 0.5,
    lastActivityAt: null,
    nextDeadline: null,
    notes: null,
    ...overrides,
  };
}

export function toLegacyClient(client: DomainClient): Record<string, unknown> {
  return {
    "Client ID": client.id,
    "Client Name": client.name,
    "Company Name": client.companyName ?? "",
    Industry: client.industry ?? "",
    "Business Type": client.businessType ?? "",
    "Service Package": client.servicePackageName ?? "",
    "Account Manager": client.accountManagerName ?? "",
    "Backup Team Member": client.backupMemberName ?? "",
    "Client Contact": client.contactName ?? "",
    Email: client.email ?? "",
    Phone: client.phone ?? "",
    "Contract Status": CONTRACT_TO_LEGACY[client.contractStatus],
    Priority: PRIORITY_TO_LEGACY[client.priority],
    "Client Health": HEALTH_TO_LEGACY[client.health],
    "Simple Completion %": client.simpleCompletionPct,
    "Weighted Completion %": client.weightedCompletionPct,
    "Last Activity": toLegacyDate(client.lastActivityAt),
    "Next Deadline": toLegacyDate(client.nextDeadline),
    Notes: client.notes ?? "",
  };
}

export function makeIssue(overrides: Partial<DomainIssue> = {}): DomainIssue {
  return {
    id: nextId(),
    displayId: nextDisplayId("ISS-", 4),
    clientId: "client-1",
    clientName: "Acme Co",
    title: "Late docs",
    category: "Data Quality",
    severity: IssueSeverity.MEDIUM,
    status: IssueStatus.OPEN,
    assignedToName: "Jane AM",
    dateRaised: d("2026-08-01"),
    deadline: null,
    requiredAction: null,
    ...overrides,
  };
}

export function toLegacyIssue(issue: DomainIssue): Record<string, unknown> {
  return {
    "Issue ID": issue.displayId,
    "Client ID": issue.clientId,
    Client: issue.clientName,
    Issue: issue.title,
    Category: issue.category ?? "",
    Severity: SEVERITY_TO_LEGACY[issue.severity],
    Status: ISSUE_STATUS_TO_LEGACY[issue.status],
    "Assigned To": issue.assignedToName ?? "",
    "Date Raised": toLegacyDate(issue.dateRaised),
    Deadline: toLegacyDate(issue.deadline),
    "Required Action": issue.requiredAction ?? "",
  };
}

export function makeRequest(
  overrides: Partial<DomainRequest> = {},
): DomainRequest {
  return {
    id: nextId(),
    displayId: nextDisplayId("REQ-", 4),
    clientId: "client-1",
    clientName: "Acme Co",
    title: "Bank statements",
    status: RequestStatus.REQUESTED,
    priority: Priority.MEDIUM,
    requestedDate: d("2026-08-01"),
    requiredBy: null,
    receivedDate: null,
    assignedToName: "Jane AM",
    ...overrides,
  };
}

/**
 * Legacy request rows carried a precomputed `Days Waiting` column, so the
 * caller must supply it. CoreWorks derives it instead — the value passed here
 * comes from the same date rule, which is itself parity-tested.
 */
export function toLegacyRequest(
  request: DomainRequest,
  daysWaiting: number | null,
): Record<string, unknown> {
  return {
    "Request ID": request.displayId,
    "Client ID": request.clientId,
    Client: request.clientName,
    Request: request.title,
    "Requested Date": toLegacyDate(request.requestedDate),
    "Required By": toLegacyDate(request.requiredBy),
    Status: REQUEST_STATUS_TO_LEGACY[request.status],
    "Days Waiting": daysWaiting ?? "",
    Priority: PRIORITY_TO_LEGACY[request.priority],
    "Assigned To": request.assignedToName ?? "",
    "Received Date": toLegacyDate(request.receivedDate),
  };
}

export function makeMember(overrides: Partial<DomainMember> = {}): DomainMember {
  return {
    id: nextId(),
    name: "Jane AM",
    jobTitle: "Account Manager",
    isActive: true,
    capacity: null,
    ...overrides,
  };
}

export function toLegacyEmployee(member: DomainMember): Record<string, unknown> {
  return {
    "Employee ID": "EMP-001",
    "Employee Name": member.name,
    Role: member.jobTitle ?? "",
    "Active?": member.isActive ? "Yes" : "No",
    Capacity: member.capacity ?? "",
  };
}
