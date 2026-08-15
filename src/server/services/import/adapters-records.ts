import {
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  Priority,
  ReportingFrequency,
  RequestStatus,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";
import type { EntityType, Frequency } from "@/generated/prisma/enums";
import { buildMonthlyCloseId } from "@/lib/domain/ids";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import {
  isBlank,
  parseCloseStageStatus,
  parseContractStatus,
  parseEntityType,
  parseFrequency,
  parseIssueSeverity,
  parseIssueStatus,
  parseLegacyDate,
  parseLegacyInt,
  parseLegacyPercent,
  parseLegacyPeriod,
  parsePriority,
  parseReportingFrequency,
  parseRequestStatus,
  parseReviewStatus,
  parseTaskCategory,
  parseTaskStatus,
  parseText,
  parseYesNo,
} from "@/lib/domain/legacy-values";
import { nextDisplayId } from "@/server/services/ids";

import type {
  Db,
  ImportAdapter,
  Lookups,
  ParseResult,
  UnmatchedReference,
} from "./types";

/**
 * Import adapters for the record sheets: CLIENTS, TASKS, CLIENT_REQUESTS,
 * ISSUES, MONTHLY_CLOSE, ACTIVITY_LOG, SETTINGS.
 *
 * ---------------------------------------------------------------------------
 * Name-based references (migration-plan §3.4)
 * ---------------------------------------------------------------------------
 *
 * Legacy joined several relationships by display name (audit D4). Each is
 * resolved to a real foreign key here, and the plan specifies a DIFFERENT
 * policy per column — which is the whole point, so they are not collapsed
 * into one helper with one behaviour:
 *
 * | Column | Unmatched |
 * |---|---|
 * | `CLIENTS.Account Manager` | **Reject row** — required |
 * | `CLIENTS.Backup Team Member` | Warn, leave null |
 * | `TASKS.Assigned To` | Warn, leave unassigned |
 * | `ACTIVITY_LOG.Client` | Warn, keep as text |
 * | `MONTHLY_CLOSE.Client` | **Reject row** |
 *
 * Every unmatched name is reported individually and never silently dropped.
 *
 * ---------------------------------------------------------------------------
 * Derived columns
 * ---------------------------------------------------------------------------
 *
 * `Client Health`, the completion percentages, `Last Activity`, `Next
 * Deadline`, `Days Remaining`, `Days Overdue`, `Days Waiting`, its bucket, and
 * the close's `Completion %` / `Close Status` are **read but not stored**
 * (migration-plan §3.2). The engines recompute them, and the difference
 * between a recomputed value and the spreadsheet's is a genuine finding.
 */

function warn(
  column: string,
  value: string,
  action: UnmatchedReference["action"],
): UnmatchedReference {
  return { column, value, occurrences: 1, action };
}

/** Resolves a person by name, then by email — legacy sheets held either. */
function resolveMember(lookups: Lookups, value: string): string | null {
  const key = value.trim().toLowerCase();
  if (key === "") return null;
  return lookups.membersByName.get(key) ?? lookups.membersByEmail.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// CLIENTS
// ---------------------------------------------------------------------------

export interface ClientRow {
  displayId: string | null;
  name: string;
  companyName: string | null;
  industry: string | null;
  businessType: string | null;
  startDate: Date | null;
  servicePackageId: string | null;
  accountManagerId: string;
  backupMemberId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accountingSystem: string | null;
  reportingFrequency: ReportingFrequency | null;
  monthEndClosingDay: number | null;
  contractStatus: ContractStatus;
  priority: Priority;
  notes: string | null;
}

export const clientAdapter: ImportAdapter<ClientRow> = {
  sheet: "CLIENTS",
  idEntity: "CLIENT",
  idColumn: "Client ID",

  parse(read, lookups): ParseResult<ClientRow> {
    const warnings: UnmatchedReference[] = [];

    const name = read("Client Name");
    if (isBlank(name)) return { ok: false, reason: "Client Name is required." };

    // §3.4: Account Manager unmatched → REJECT. Legacy `createNewClient`
    // required it (audit §6.9) and every dashboard groups by it.
    const managerName = read("Account Manager");
    if (isBlank(managerName)) {
      return { ok: false, reason: "Account Manager is required." };
    }
    const accountManagerId = resolveMember(lookups, managerName);
    if (!accountManagerId) {
      return {
        ok: false,
        reason: `Account Manager "${managerName}" was not found. Import Employees first.`,
        warnings: [warn("Account Manager", managerName, "rejected")],
      };
    }

    // §3.4: Backup Team Member unmatched → warn, leave null.
    const backupName = read("Backup Team Member");
    let backupMemberId: string | null = null;
    if (!isBlank(backupName)) {
      backupMemberId = resolveMember(lookups, backupName);
      if (!backupMemberId) {
        warnings.push(warn("Backup Team Member", backupName, "left blank"));
      }
    }

    const packageName = read("Service Package");
    let servicePackageId: string | null = null;
    if (!isBlank(packageName)) {
      servicePackageId =
        lookups.packagesByName.get(packageName.trim().toLowerCase()) ?? null;
      if (!servicePackageId) {
        warnings.push(warn("Service Package", packageName, "left blank"));
      }
    }

    // Legacy REQUIRED Start Date for client creation (audit §6.9, conflict
    // C2), so a blank one is a row failure rather than a null.
    const startCell = read("Start Date");
    const startDate = parseLegacyDate(startCell);
    if (isBlank(startCell)) {
      return { ok: false, reason: "Start Date is required." };
    }
    if (startDate === null) {
      return {
        ok: false,
        reason: `Start Date "${startCell}" is not a valid date. Use YYYY-MM-DD.`,
      };
    }

    const statusCell = read("Contract Status");
    const contractStatus = parseContractStatus(statusCell);
    if (!isBlank(statusCell) && contractStatus === null) {
      return {
        ok: false,
        reason: `"${statusCell}" is not a valid Contract Status.`,
      };
    }

    const priorityCell = read("Priority");
    const priority = parsePriority(priorityCell);
    if (!isBlank(priorityCell) && priority === null) {
      return { ok: false, reason: `"${priorityCell}" is not a valid Priority.` };
    }

    const reportingCell = read("Reporting Frequency");
    const reportingFrequency = parseReportingFrequency(reportingCell);
    if (!isBlank(reportingCell) && reportingFrequency === null) {
      return {
        ok: false,
        reason: `"${reportingCell}" is not a valid Reporting Frequency.`,
      };
    }

    const closingCell = read("Month-End Closing Date");
    const monthEndClosingDay = parseLegacyInt(closingCell);
    if (!isBlank(closingCell) && monthEndClosingDay === null) {
      return {
        ok: false,
        reason: `Month-End Closing Date must be a day of the month, not "${closingCell}".`,
      };
    }
    if (
      monthEndClosingDay !== null &&
      (monthEndClosingDay < 1 || monthEndClosingDay > 31)
    ) {
      return {
        ok: false,
        reason: "Month-End Closing Date must be between 1 and 31.",
      };
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Client ID")),
        name: name.trim(),
        companyName: parseText(read("Company Name")),
        industry: parseText(read("Industry")),
        businessType: parseText(read("Business Type")),
        startDate,
        servicePackageId,
        accountManagerId,
        backupMemberId,
        contactName: parseText(read("Client Contact")),
        email: parseText(read("Email")),
        phone: parseText(read("Phone")),
        accountingSystem: parseText(read("Accounting System")),
        reportingFrequency,
        monthEndClosingDay,
        contractStatus: contractStatus ?? ContractStatus.ONBOARDING,
        priority: priority ?? Priority.MEDIUM,
        notes: parseText(read("Notes")),
      },
      warnings,
    };
  },

  /**
   * Legacy's own duplicate rule: same Client Name AND Company Name
   * (audit §6.9), which the schema also enforces as a unique constraint.
   */
  dedupeKey: (value) =>
    `${value.name.toLowerCase()}|${(value.companyName ?? "").toLowerCase()}`,

  async existingKeys(ctx, db) {
    const clients = await db.client.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true, companyName: true },
    });
    return new Set(
      clients.map(
        (c) => `${c.name.toLowerCase()}|${(c.companyName ?? "").toLowerCase()}`,
      ),
    );
  },

  async insert(ctx, db, value) {
    await db.client.create({
      data: {
        organizationId: ctx.organizationId,
        displayId:
          value.displayId ?? (await nextDisplayId(ctx.organizationId, "CLIENT", db)),
        name: value.name,
        companyName: value.companyName,
        industry: value.industry,
        businessType: value.businessType,
        startDate: value.startDate,
        servicePackageId: value.servicePackageId,
        accountManagerId: value.accountManagerId,
        backupMemberId: value.backupMemberId,
        contactName: value.contactName,
        email: value.email,
        phone: value.phone,
        accountingSystem: value.accountingSystem,
        reportingFrequency: value.reportingFrequency,
        monthEndClosingDay: value.monthEndClosingDay,
        contractStatus: value.contractStatus,
        priority: value.priority,
        notes: value.notes,
        // Health and the completion figures are deliberately left at their
        // schema defaults — §3.2. The first recalculation pass produces them,
        // and a disagreement with the spreadsheet is a finding to review.
      },
    });
  },

  label: (value) => value.name,
};

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

export interface TaskRow {
  displayId: string | null;
  clientId: string;
  serviceArea: string;
  taskCategory: TaskCategory;
  taskName: string;
  description: string | null;
  period: string | null;
  frequency: Frequency | null;
  assignedToId: string | null;
  reviewerId: string | null;
  priority: Priority;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
  completionDate: Date | null;
  waitingFor: string | null;
  clientDependency: boolean;
  completionPct: number;
  reviewStatus: ReviewStatus;
  notes: string | null;
}

/** Resolves a task/request/issue row's client by display ID, then by name. */
function resolveClient(
  lookups: Lookups,
  displayId: string,
  name: string,
): string | null {
  if (displayId.trim() !== "") {
    const byId = lookups.clientsByDisplayId.get(displayId.trim());
    if (byId) return byId;
  }
  if (name.trim() !== "") {
    return lookups.clientsByName.get(name.trim().toLowerCase()) ?? null;
  }
  return null;
}

export const taskAdapter: ImportAdapter<TaskRow> = {
  sheet: "TASKS",
  idEntity: "TASK",
  idColumn: "Task ID",

  parse(read, lookups): ParseResult<TaskRow> {
    const warnings: UnmatchedReference[] = [];

    const clientDisplayId = read("Client ID");
    const clientName = read("Client Name");
    const clientId = resolveClient(lookups, clientDisplayId, clientName);
    if (!clientId) {
      // A task with no client cannot exist — every dashboard groups by it.
      return {
        ok: false,
        reason: `Client "${clientName || clientDisplayId}" was not found. Import Clients first.`,
        warnings: [
          warn("Client Name", clientName || clientDisplayId, "rejected"),
        ],
      };
    }

    const taskName = read("Task Name");
    if (isBlank(taskName)) return { ok: false, reason: "Task Name is required." };

    const serviceArea = read("Service Area");
    if (isBlank(serviceArea)) {
      return { ok: false, reason: "Service Area is required." };
    }

    const statusCell = read("Status");
    const status = parseTaskStatus(statusCell);
    if (!isBlank(statusCell) && status === null) {
      return { ok: false, reason: `"${statusCell}" is not a valid Status.` };
    }

    const priorityCell = read("Priority");
    const priority = parsePriority(priorityCell);
    if (!isBlank(priorityCell) && priority === null) {
      return { ok: false, reason: `"${priorityCell}" is not a valid Priority.` };
    }

    const categoryCell = read("Task Category");
    const taskCategory = parseTaskCategory(categoryCell);
    if (!isBlank(categoryCell) && taskCategory === null) {
      return {
        ok: false,
        reason: `"${categoryCell}" is not a valid Task Category.`,
      };
    }

    const reviewCell = read("Review Status");
    const reviewStatus = parseReviewStatus(reviewCell);
    if (!isBlank(reviewCell) && reviewStatus === null) {
      return {
        ok: false,
        reason: `"${reviewCell}" is not a valid Review Status.`,
      };
    }

    const frequencyCell = read("Frequency");
    const frequency = parseFrequency(frequencyCell);
    if (!isBlank(frequencyCell) && frequency === null) {
      return { ok: false, reason: `"${frequencyCell}" is not a valid Frequency.` };
    }

    const periodCell = read("Period");
    const period = parseLegacyPeriod(periodCell);
    if (!isBlank(periodCell) && period === null) {
      return {
        ok: false,
        reason: `Period "${periodCell}" is not a valid YYYY-MM month.`,
      };
    }

    for (const [column, cellValue] of [
      ["Start Date", read("Start Date")],
      ["Due Date", read("Due Date")],
      ["Completion Date", read("Completion Date")],
    ] as const) {
      if (!isBlank(cellValue) && parseLegacyDate(cellValue) === null) {
        return {
          ok: false,
          reason: `${column} "${cellValue}" is not a valid date. Use YYYY-MM-DD.`,
        };
      }
    }

    // §3.4: Assigned To unmatched → warn, leave unassigned. The task is real
    // work that still has to be tracked; who does it can be fixed afterwards.
    const assigneeName = read("Assigned To");
    let assignedToId: string | null = null;
    if (!isBlank(assigneeName)) {
      assignedToId = resolveMember(lookups, assigneeName);
      if (!assignedToId) warnings.push(warn("Assigned To", assigneeName, "left blank"));
    }

    const reviewerName = read("Reviewer");
    let reviewerId: string | null = null;
    if (!isBlank(reviewerName)) {
      reviewerId = resolveMember(lookups, reviewerName);
      if (!reviewerId) warnings.push(warn("Reviewer", reviewerName, "left blank"));
    }

    const dependencyCell = read("Client Dependency");
    const clientDependency = parseYesNo(dependencyCell);
    if (!isBlank(dependencyCell) && clientDependency === null) {
      return {
        ok: false,
        reason: `Client Dependency must be Yes or No, not "${dependencyCell}".`,
      };
    }

    // Task-level Completion % IS stored in legacy — unlike the client-level
    // rollups, which are derived. See DERIVED_COLUMNS.
    const completionCell = read("Completion %");
    const completionPct = parseLegacyPercent(completionCell);
    if (!isBlank(completionCell) && completionPct === null) {
      return {
        ok: false,
        reason: `Completion % "${completionCell}" is not a percentage between 0 and 100.`,
      };
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Task ID")),
        clientId,
        serviceArea: serviceArea.trim(),
        taskCategory: taskCategory ?? TaskCategory.AD_HOC,
        taskName: taskName.trim(),
        description: parseText(read("Description")),
        period,
        frequency,
        assignedToId,
        reviewerId,
        priority: priority ?? Priority.MEDIUM,
        status: status ?? TaskStatus.NOT_STARTED,
        startDate: parseLegacyDate(read("Start Date")),
        dueDate: parseLegacyDate(read("Due Date")),
        completionDate: parseLegacyDate(read("Completion Date")),
        waitingFor: parseText(read("Waiting For")),
        clientDependency: clientDependency ?? false,
        completionPct: completionPct ?? 0,
        reviewStatus: reviewStatus ?? ReviewStatus.NOT_REVIEWED,
        notes: parseText(read("Notes")),
      },
      warnings,
    };
  },

  /**
   * The legacy generation dedupe key, verbatim (audit §6.11):
   * `clientId|serviceArea|taskName|period`. Reusing it is what makes an
   * import and a monthly generation agree about what already exists.
   */
  dedupeKey: (value) =>
    [
      value.clientId,
      value.serviceArea.toLowerCase(),
      value.taskName.toLowerCase(),
      value.period ?? "",
    ].join("|"),

  async existingKeys(ctx, db) {
    const tasks = await db.task.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        clientId: true,
        serviceArea: true,
        taskName: true,
        period: true,
      },
    });
    return new Set(
      tasks.map((t) =>
        [
          t.clientId,
          t.serviceArea.toLowerCase(),
          t.taskName.toLowerCase(),
          t.period ?? "",
        ].join("|"),
      ),
    );
  },

  async insert(ctx, db, value) {
    await db.task.create({
      data: {
        organizationId: ctx.organizationId,
        displayId:
          value.displayId ?? (await nextDisplayId(ctx.organizationId, "TASK", db)),
        clientId: value.clientId,
        serviceArea: value.serviceArea,
        taskCategory: value.taskCategory,
        taskName: value.taskName,
        description: value.description,
        period: value.period,
        frequency: value.frequency,
        assignedToId: value.assignedToId,
        reviewerId: value.reviewerId,
        priority: value.priority,
        status: value.status,
        startDate: value.startDate,
        dueDate: value.dueDate,
        completionDate: value.completionDate,
        waitingFor: value.waitingFor,
        clientDependency: value.clientDependency,
        completionPct: value.completionPct,
        reviewStatus: value.reviewStatus,
        notes: value.notes,
      },
    });
  },

  label: (value) => value.taskName,
};

// ---------------------------------------------------------------------------
// CLIENT_REQUESTS
// ---------------------------------------------------------------------------

export interface RequestRow {
  displayId: string | null;
  clientId: string;
  title: string;
  requestedDate: Date;
  requiredBy: Date | null;
  receivedDate: Date | null;
  status: RequestStatus;
  priority: Priority;
  assignedToId: string | null;
  notes: string | null;
}

export const requestAdapter: ImportAdapter<RequestRow> = {
  sheet: "CLIENT_REQUESTS",
  idEntity: "CLIENT_REQUEST",
  idColumn: "Request ID",

  parse(read, lookups): ParseResult<RequestRow> {
    const warnings: UnmatchedReference[] = [];

    const clientId = resolveClient(lookups, read("Client ID"), read("Client"));
    if (!clientId) {
      const shown = read("Client") || read("Client ID");
      return {
        ok: false,
        reason: `Client "${shown}" was not found. Import Clients first.`,
        warnings: [warn("Client", shown, "rejected")],
      };
    }

    const title = read("Request");
    if (isBlank(title)) return { ok: false, reason: "Request is required." };

    const statusCell = read("Status");
    const status = parseRequestStatus(statusCell);
    if (!isBlank(statusCell) && status === null) {
      return { ok: false, reason: `"${statusCell}" is not a valid Status.` };
    }

    const priorityCell = read("Priority");
    const priority = parsePriority(priorityCell);
    if (!isBlank(priorityCell) && priority === null) {
      return { ok: false, reason: `"${priorityCell}" is not a valid Priority.` };
    }

    // Requested Date anchors Days Waiting (audit §6.4), which is derived on
    // read — so it is required rather than nullable.
    const requestedCell = read("Requested Date");
    const requestedDate = parseLegacyDate(requestedCell);
    if (isBlank(requestedCell)) {
      return { ok: false, reason: "Requested Date is required." };
    }
    if (requestedDate === null) {
      return {
        ok: false,
        reason: `Requested Date "${requestedCell}" is not a valid date. Use YYYY-MM-DD.`,
      };
    }

    for (const [column, cellValue] of [
      ["Required By", read("Required By")],
      ["Received Date", read("Received Date")],
    ] as const) {
      if (!isBlank(cellValue) && parseLegacyDate(cellValue) === null) {
        return {
          ok: false,
          reason: `${column} "${cellValue}" is not a valid date. Use YYYY-MM-DD.`,
        };
      }
    }

    const assigneeName = read("Assigned To");
    let assignedToId: string | null = null;
    if (!isBlank(assigneeName)) {
      assignedToId = resolveMember(lookups, assigneeName);
      if (!assignedToId) warnings.push(warn("Assigned To", assigneeName, "left blank"));
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Request ID")),
        clientId,
        title: title.trim(),
        requestedDate,
        requiredBy: parseLegacyDate(read("Required By")),
        receivedDate: parseLegacyDate(read("Received Date")),
        status: status ?? RequestStatus.REQUESTED,
        priority: priority ?? Priority.MEDIUM,
        assignedToId,
        notes: parseText(read("Notes")),
      },
      warnings,
    };
  },

  dedupeKey: (value) =>
    [
      value.clientId,
      value.title.toLowerCase(),
      value.requestedDate.toISOString().slice(0, 10),
    ].join("|"),

  async existingKeys(ctx, db) {
    const requests = await db.clientRequest.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { clientId: true, title: true, requestedDate: true },
    });
    return new Set(
      requests.map((r) =>
        [
          r.clientId,
          r.title.toLowerCase(),
          r.requestedDate?.toISOString().slice(0, 10) ?? "",
        ].join("|"),
      ),
    );
  },

  async insert(ctx, db, value) {
    await db.clientRequest.create({
      data: {
        organizationId: ctx.organizationId,
        displayId:
          value.displayId ??
          (await nextDisplayId(ctx.organizationId, "CLIENT_REQUEST", db)),
        clientId: value.clientId,
        title: value.title,
        requestedDate: value.requestedDate,
        requiredBy: value.requiredBy,
        receivedDate: value.receivedDate,
        status: value.status,
        priority: value.priority,
        assignedToId: value.assignedToId,
        notes: value.notes,
        // Days Waiting and its bucket are never stored — legacy read them from
        // a live ARRAYFORMULA and CoreWorks derives them on read (§3.2).
      },
    });
  },

  label: (value) => value.title,
};

// ---------------------------------------------------------------------------
// ISSUES
// ---------------------------------------------------------------------------

export interface IssueRow {
  displayId: string | null;
  clientId: string;
  title: string;
  category: string | null;
  dateRaised: Date;
  severity: IssueSeverity;
  assignedToId: string | null;
  status: IssueStatus;
  impact: string | null;
  requiredAction: string | null;
  deadline: Date | null;
  resolutionDate: Date | null;
  notes: string | null;
}

export const issueAdapter: ImportAdapter<IssueRow> = {
  sheet: "ISSUES",
  idEntity: "ISSUE",
  idColumn: "Issue ID",

  parse(read, lookups): ParseResult<IssueRow> {
    const warnings: UnmatchedReference[] = [];

    const clientId = resolveClient(lookups, read("Client ID"), read("Client"));
    if (!clientId) {
      const shown = read("Client") || read("Client ID");
      return {
        ok: false,
        reason: `Client "${shown}" was not found. Import Clients first.`,
        warnings: [warn("Client", shown, "rejected")],
      };
    }

    const title = read("Issue");
    if (isBlank(title)) return { ok: false, reason: "Issue is required." };

    const severityCell = read("Severity");
    const severity = parseIssueSeverity(severityCell);
    if (!isBlank(severityCell) && severity === null) {
      return { ok: false, reason: `"${severityCell}" is not a valid Severity.` };
    }

    const statusCell = read("Status");
    const status = parseIssueStatus(statusCell);
    if (!isBlank(statusCell) && status === null) {
      return { ok: false, reason: `"${statusCell}" is not a valid Status.` };
    }

    // Legacy defaulted Date Raised to today at creation; a file that omits it
    // has lost information, so the row is rejected rather than back-dated to
    // the import date, which would silently distort issue age.
    const raisedCell = read("Date Raised");
    const dateRaised = parseLegacyDate(raisedCell);
    if (isBlank(raisedCell)) {
      return { ok: false, reason: "Date Raised is required." };
    }
    if (dateRaised === null) {
      return {
        ok: false,
        reason: `Date Raised "${raisedCell}" is not a valid date. Use YYYY-MM-DD.`,
      };
    }

    for (const [column, cellValue] of [
      ["Deadline", read("Deadline")],
      ["Resolution Date", read("Resolution Date")],
    ] as const) {
      if (!isBlank(cellValue) && parseLegacyDate(cellValue) === null) {
        return {
          ok: false,
          reason: `${column} "${cellValue}" is not a valid date. Use YYYY-MM-DD.`,
        };
      }
    }

    const assigneeName = read("Assigned To");
    let assignedToId: string | null = null;
    if (!isBlank(assigneeName)) {
      assignedToId = resolveMember(lookups, assigneeName);
      if (!assignedToId) warnings.push(warn("Assigned To", assigneeName, "left blank"));
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Issue ID")),
        clientId,
        title: title.trim(),
        category: parseText(read("Category")),
        dateRaised,
        severity: severity ?? IssueSeverity.MEDIUM,
        assignedToId,
        status: status ?? IssueStatus.OPEN,
        impact: parseText(read("Impact")),
        requiredAction: parseText(read("Required Action")),
        deadline: parseLegacyDate(read("Deadline")),
        resolutionDate: parseLegacyDate(read("Resolution Date")),
        notes: parseText(read("Notes")),
      },
      warnings,
    };
  },

  dedupeKey: (value) =>
    [
      value.clientId,
      value.title.toLowerCase(),
      value.dateRaised.toISOString().slice(0, 10),
    ].join("|"),

  async existingKeys(ctx, db) {
    const issues = await db.issue.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { clientId: true, title: true, dateRaised: true },
    });
    return new Set(
      issues.map((i) =>
        [
          i.clientId,
          i.title.toLowerCase(),
          i.dateRaised?.toISOString().slice(0, 10) ?? "",
        ].join("|"),
      ),
    );
  },

  async insert(ctx, db, value) {
    await db.issue.create({
      data: {
        organizationId: ctx.organizationId,
        displayId:
          value.displayId ?? (await nextDisplayId(ctx.organizationId, "ISSUE", db)),
        clientId: value.clientId,
        title: value.title,
        category: value.category,
        dateRaised: value.dateRaised,
        severity: value.severity,
        assignedToId: value.assignedToId,
        status: value.status,
        impact: value.impact,
        requiredAction: value.requiredAction,
        deadline: value.deadline,
        resolutionDate: value.resolutionDate,
        notes: value.notes,
      },
    });
  },

  label: (value) => value.title,
};

// ---------------------------------------------------------------------------
// MONTHLY_CLOSE — the one structural transform (migration-plan §3.6)
// ---------------------------------------------------------------------------

export interface MonthlyCloseRow {
  clientId: string;
  clientDisplayId: string;
  period: string;
  /** 18 stages, in the legacy column order. */
  stages: { stageName: string; stageOrder: number; status: string }[];
}

export const monthlyCloseAdapter: ImportAdapter<MonthlyCloseRow> = {
  sheet: "MONTHLY_CLOSE",

  parse(read, lookups): ParseResult<MonthlyCloseRow> {
    // §3.4: MONTHLY_CLOSE.Client unmatched → REJECT.
    const clientName = read("Client");
    const clientId = resolveClient(lookups, "", clientName);
    if (!clientId) {
      return {
        ok: false,
        reason: `Client "${clientName}" was not found. Import Clients first.`,
        warnings: [warn("Client", clientName, "rejected")],
      };
    }

    const monthCell = read("Month");
    const period = parseLegacyPeriod(monthCell);
    if (period === null) {
      return {
        ok: false,
        reason: isBlank(monthCell)
          ? "Month is required."
          : `Month "${monthCell}" is not a valid YYYY-MM period.`,
      };
    }

    /*
     * The structural transform (§3.6): 18 stage COLUMNS become 18 stage ROWS,
     * `stageOrder` preserving the legacy column order from
     * MONTHLY_CLOSE_STAGE_COLUMNS.
     *
     * A blank cell becomes Not Started rather than being skipped, which is
     * Phase 3's DIFF-1: legacy's COUNTA denominator counted only non-blank
     * cells, so a close with one touched stage read 100%. Materialising all
     * eighteen makes the denominator always eighteen.
     */
    const stages: MonthlyCloseRow["stages"] = [];
    for (const [order, stageName] of MONTHLY_CLOSE_STAGES.entries()) {
      const cellValue = read(stageName);
      const status = parseCloseStageStatus(cellValue);
      if (!isBlank(cellValue) && status === null) {
        return {
          ok: false,
          reason: `Stage "${stageName}" has an invalid status "${cellValue}".`,
        };
      }
      stages.push({
        stageName,
        stageOrder: order,
        status: status ?? "NOT_STARTED",
      });
    }

    return {
      ok: true,
      value: {
        clientId,
        clientDisplayId: lookups.clientDisplayIds.get(clientId) ?? "",
        period,
        stages,
      },
    };
  },

  // One close per client per period — the schema's own unique constraint, and
  // what the legacy composite id encodes.
  dedupeKey: (value) => `${value.clientId}|${value.period}`,

  async existingKeys(ctx, db) {
    const closes = await db.monthlyClose.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { clientId: true, period: true },
    });
    return new Set(closes.map((c) => `${c.clientId}|${c.period}`));
  },

  async insert(ctx, db, value) {
    await db.monthlyClose.create({
      data: {
        organizationId: ctx.organizationId,
        // Legacy composite format, rebuilt from the resolved client rather
        // than trusting the file's Close ID — a renamed client would otherwise
        // carry a stale id forward.
        displayId: buildMonthlyCloseId(value.clientDisplayId, value.period),
        clientId: value.clientId,
        period: value.period,
        stages: {
          createMany: {
            data: value.stages.map((stage) => ({
              stageName: stage.stageName,
              stageOrder: stage.stageOrder,
              status: stage.status as never,
            })),
          },
        },
        // completionPct and status are DERIVED (§3.2/§3.6) — recomputed by
        // recalculateClose, never imported.
      },
    });
  },

  label: (value) => `${value.clientDisplayId} ${value.period}`,
};

// ---------------------------------------------------------------------------
// ACTIVITY_LOG
// ---------------------------------------------------------------------------

export interface ActivityRow {
  displayId: string | null;
  createdAt: Date;
  userEmail: string | null;
  userId: string | null;
  clientId: string | null;
  /** Kept when the client name did not resolve — §3.4 says keep as text. */
  clientText: string | null;
  entityType: EntityType;
  entityId: string | null;
  action: string;
  previousValue: string | null;
  newValue: string | null;
  comment: string | null;
}

export const activityAdapter: ImportAdapter<ActivityRow> = {
  sheet: "ACTIVITY_LOG",
  idEntity: "ACTIVITY",
  idColumn: "Activity ID",

  parse(read, lookups): ParseResult<ActivityRow> {
    const warnings: UnmatchedReference[] = [];

    const action = read("Action");
    if (isBlank(action)) return { ok: false, reason: "Action is required." };

    const dateCell = read("Date");
    const createdAt = parseLegacyDate(dateCell);
    if (isBlank(dateCell)) return { ok: false, reason: "Date is required." };
    if (createdAt === null) {
      return {
        ok: false,
        reason: `Date "${dateCell}" is not a valid date. Use YYYY-MM-DD.`,
      };
    }

    const entityCell = read("Entity Type");
    const entityType = parseEntityType(entityCell);
    if (entityType === null) {
      return {
        ok: false,
        reason: isBlank(entityCell)
          ? "Entity Type is required."
          : `"${entityCell}" is not a valid Entity Type.`,
      };
    }

    // §3.4: ACTIVITY_LOG.Client unmatched → warn, KEEP AS TEXT. History about
    // a client that no longer exists is still history, and discarding it would
    // silently shorten the audit trail.
    const clientName = read("Client");
    let clientId: string | null = null;
    let clientText: string | null = null;
    if (!isBlank(clientName)) {
      clientId = lookups.clientsByName.get(clientName.trim().toLowerCase()) ?? null;
      if (!clientId) {
        clientText = clientName.trim();
        warnings.push(warn("Client", clientName, "kept as text"));
      }
    }

    const userName = read("User");
    const memberId = isBlank(userName) ? null : resolveMember(lookups, userName);
    if (!isBlank(userName) && !memberId) {
      warnings.push(warn("User", userName, "kept as text"));
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Activity ID")),
        createdAt,
        // The email snapshot is what survives a user being deleted (audit D4),
        // so the legacy name is stored there even when it did not resolve.
        userEmail: parseText(userName),
        userId: null,
        clientId,
        clientText,
        entityType,
        entityId: parseText(read("Entity ID")),
        action: action.trim(),
        previousValue: parseText(read("Previous Value")),
        newValue: parseText(read("New Value")),
        comment: parseText(read("Comment")),
      },
      warnings,
    };
  },

  /**
   * The legacy Activity ID, when present. An audit trail has no natural key —
   * two identical entries a second apart are two real events — so without an
   * id the row is always inserted rather than guessed at.
   */
  dedupeKey: (value) => value.displayId,

  async existingKeys(ctx, db) {
    const entries = await db.activityLog.findMany({
      where: { organizationId: ctx.organizationId },
      select: { displayId: true },
    });
    return new Set(entries.map((e) => e.displayId));
  },

  async insert(ctx, db, value) {
    await db.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        displayId:
          value.displayId ??
          (await nextDisplayId(ctx.organizationId, "ACTIVITY", db)),
        userId: null,
        userEmail: value.userEmail,
        clientId: value.clientId,
        entityType: value.entityType,
        entityId: value.entityId,
        action: value.action,
        previousValue: value.previousValue,
        newValue: value.newValue,
        // The unresolved client name is appended rather than lost.
        comment:
          value.clientText === null
            ? value.comment
            : [value.comment, `Client (unmatched): ${value.clientText}`]
                .filter(Boolean)
                .join(" · "),
        createdAt: value.createdAt,
      },
    });
  },

  label: (value) => value.action,
};

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------

export interface SettingRow {
  category: string;
  key: string;
  value: string;
  description: string | null;
}

export const settingAdapter: ImportAdapter<SettingRow> = {
  sheet: "SETTINGS",

  parse(read): ParseResult<SettingRow> {
    const key = read("Setting Key");
    if (isBlank(key)) return { ok: false, reason: "Setting Key is required." };

    const value = read("Value");
    if (isBlank(value)) return { ok: false, reason: "Value is required." };

    return {
      ok: true,
      value: {
        category: parseText(read("Setting Category")) ?? "General",
        key: key.trim(),
        value: value.trim(),
        description: parseText(read("Description")),
      },
    };
  },

  dedupeKey: (value) => value.key,

  async existingKeys(ctx, db) {
    const settings = await db.organizationSetting.findMany({
      where: { organizationId: ctx.organizationId },
      select: { key: true },
    });
    return new Set(settings.map((s) => s.key));
  },

  async insert(ctx, db, value) {
    await db.organizationSetting.create({
      data: {
        organizationId: ctx.organizationId,
        category: value.category,
        key: value.key,
        value: value.value,
        description: value.description,
      },
    });
  },

  label: (value) => value.key,
};

export type { Db };
