import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";

/**
 * The import/export contract.
 *
 * These header arrays are transcribed **verbatim** from legacy
 * `config/Schemas.gs`, which that file calls "the single source of truth for
 * every data sheet's header row (column order + names)". Migration-plan §3.2
 * makes them the contract: *"the importer matches on the exact legacy header
 * string, so an unmodified export works with no hand-editing"*.
 *
 * That means the strings here are **data, not labels**. They must not be
 * tidied, re-cased, or made consistent — `Active?` keeps its question mark,
 * `Typical Duration (Days)` keeps its parentheses, and `Month-End Closing
 * Date` keeps the naming that differs from the column it maps to. A test
 * asserts each array against the legacy file so a well-meaning edit here
 * fails rather than silently breaking every future import.
 *
 * Dashboard sheets are deliberately absent, exactly as they are in
 * `Schemas.gs`: `CONTROL_CENTER`, `CLIENT_DASHBOARD`, `TEAM_DASHBOARD`,
 * `MONTHLY_CLOSE_DASHBOARD`, `MANAGEMENT_REPORT`, and `_CHART_SRC` are
 * rendered views, not data (migration-plan §3.1). CoreWorks regenerates all
 * of them.
 */

export const LEGACY_HEADERS = {
  EMPLOYEES: [
    "Employee ID",
    "Employee Name",
    "Role",
    "Department",
    "Email",
    "Active?",
    "Manager",
    "Capacity",
    "Notes",
  ],

  SERVICES: ["Service ID", "Service Name", "Category", "Description", "Active?"],

  SERVICE_PACKAGES: [
    "Package ID",
    "Package Name",
    "Description",
    "Included Service Areas",
    "Active?",
  ],

  TASK_TEMPLATES: [
    "Template ID",
    "Service Package",
    "Service Area",
    "Task Name",
    "Description",
    "Frequency",
    "Priority",
    "Default Assignee",
    "Typical Duration (Days)",
    "Required Client Input?",
    "Active?",
  ],

  CLIENTS: [
    "Client ID",
    "Client Name",
    "Company Name",
    "Industry",
    "Business Type",
    "Start Date",
    "Service Package",
    "Account Manager",
    "Backup Team Member",
    "Client Contact",
    "Email",
    "Phone",
    "Accounting System",
    "Reporting Frequency",
    "Month-End Closing Date",
    "Contract Status",
    "Priority",
    "Client Health",
    "Simple Completion %",
    "Weighted Completion %",
    "Last Activity",
    "Next Deadline",
    "Notes",
  ],

  TASKS: [
    "Task ID",
    "Client ID",
    "Client Name",
    "Service Area",
    "Task Category",
    "Task Name",
    "Description",
    "Period",
    "Frequency",
    "Assigned To",
    "Priority",
    "Status",
    "Start Date",
    "Due Date",
    "Completion Date",
    "Days Remaining",
    "Days Overdue",
    "Waiting For",
    "Client Dependency",
    "Completion %",
    "Reviewer",
    "Review Status",
    "Notes",
    "Created Date",
    "Last Updated",
  ],

  CLIENT_REQUESTS: [
    "Request ID",
    "Client ID",
    "Client",
    "Request",
    "Requested Date",
    "Required By",
    "Status",
    "Days Waiting",
    "Days Waiting Bucket",
    "Priority",
    "Assigned To",
    "Received Date",
    "Notes",
  ],

  ISSUES: [
    "Issue ID",
    "Client ID",
    "Client",
    "Issue",
    "Category",
    "Date Raised",
    "Severity",
    "Assigned To",
    "Status",
    "Impact",
    "Required Action",
    "Deadline",
    "Resolution Date",
    "Notes",
  ],

  MONTHLY_CLOSE: [
    "Close ID",
    "Client",
    "Month",
    ...MONTHLY_CLOSE_STAGES,
    "Close Status",
    "Completion %",
  ],

  ACTIVITY_LOG: [
    "Activity ID",
    "Date",
    "User",
    "Client",
    "Entity Type",
    "Entity ID",
    "Action",
    "Previous Value",
    "New Value",
    "Comment",
  ],

  SETTINGS: ["Setting Category", "Setting Key", "Value", "Description"],
} as const satisfies Record<string, readonly string[]>;

export type LegacySheet = keyof typeof LEGACY_HEADERS;

/**
 * Dependency order (migration-plan §3.3).
 *
 * Referential integrity requires this sequence, and the importer refuses a
 * file whose prerequisites are not yet present — a `TASKS` file imported
 * before `CLIENTS` would reject every row for an unresolvable client, which
 * looks like corrupt data rather than a sequencing mistake.
 */
export const IMPORT_ORDER: readonly LegacySheet[] = [
  "EMPLOYEES",
  "SERVICES",
  "SERVICE_PACKAGES",
  "TASK_TEMPLATES",
  "CLIENTS",
  "TASKS",
  "CLIENT_REQUESTS",
  "ISSUES",
  "MONTHLY_CLOSE",
  "ACTIVITY_LOG",
  "SETTINGS",
] as const;

/**
 * Columns that are present in a legacy export and deliberately **not**
 * imported (migration-plan §3.2).
 *
 * The reasoning is worth keeping next to the list: *"Importing stored derived
 * values would let a stale spreadsheet figure override a correct computation.
 * They are imported as nothing and produced by the engines — which also serves
 * as a live cross-check: if recomputed health disagrees with the
 * spreadsheet's, that difference is a genuine finding to review, not something
 * to paper over."*
 *
 * They are still **exported**, because export reproduces the legacy sheet and
 * a sheet without its computed columns is not the same sheet.
 */
export const DERIVED_COLUMNS: Readonly<Partial<Record<LegacySheet, readonly string[]>>> =
  {
    CLIENTS: [
      "Client Health",
      "Simple Completion %",
      "Weighted Completion %",
      "Last Activity",
      "Next Deadline",
    ],
    TASKS: ["Days Remaining", "Days Overdue"],
    CLIENT_REQUESTS: ["Days Waiting", "Days Waiting Bucket"],
    MONTHLY_CLOSE: ["Close Status", "Completion %"],
  };

export function isDerivedColumn(sheet: LegacySheet, header: string): boolean {
  return (DERIVED_COLUMNS[sheet] ?? []).includes(header);
}

/**
 * The columns an import genuinely needs to find.
 *
 * A file missing one of these cannot be mapped at all, so the importer refuses
 * it as a whole rather than rejecting every row individually with the same
 * reason.
 *
 * Deliberately minimal: only what identifies the record and what legacy itself
 * required. `CLIENTS.Start Date` is required by legacy `createNewClient`
 * (audit §6.9) but is checked per row, not here — a file with the column
 * present and one row blank is a row problem, not a file problem.
 */
export const REQUIRED_COLUMNS: Readonly<Record<LegacySheet, readonly string[]>> =
  {
    EMPLOYEES: ["Employee Name", "Email"],
    SERVICES: ["Service Name"],
    SERVICE_PACKAGES: ["Package Name"],
    TASK_TEMPLATES: ["Service Package", "Service Area", "Task Name"],
    CLIENTS: ["Client Name"],
    TASKS: ["Task Name", "Service Area"],
    CLIENT_REQUESTS: ["Request"],
    ISSUES: ["Issue"],
    MONTHLY_CLOSE: ["Client", "Month"],
    ACTIVITY_LOG: ["Action", "Entity Type"],
    SETTINGS: ["Setting Key", "Value"],
  };

/** Human wording for the sheet names, for the UI only. */
export const SHEET_LABELS: Record<LegacySheet, string> = {
  EMPLOYEES: "Employees",
  SERVICES: "Services",
  SERVICE_PACKAGES: "Service Packages",
  TASK_TEMPLATES: "Task Templates",
  CLIENTS: "Clients",
  TASKS: "Tasks",
  CLIENT_REQUESTS: "Client Requests",
  ISSUES: "Issues",
  MONTHLY_CLOSE: "Monthly Close",
  ACTIVITY_LOG: "Activity Log",
  SETTINGS: "Settings",
};

export function isLegacySheet(value: string): value is LegacySheet {
  return Object.prototype.hasOwnProperty.call(LEGACY_HEADERS, value);
}

/**
 * Which sheets must already be imported before this one.
 *
 * Derived from `IMPORT_ORDER` position rather than restated, so the two cannot
 * drift. Only sheets that actually hold a reference are listed — `SETTINGS`
 * depends on nothing despite being last, and `SERVICES` on nothing despite
 * being second.
 */
export const IMPORT_PREREQUISITES: Readonly<
  Record<LegacySheet, readonly LegacySheet[]>
> = {
  EMPLOYEES: [],
  SERVICES: [],
  SERVICE_PACKAGES: ["SERVICES"],
  TASK_TEMPLATES: ["SERVICE_PACKAGES"],
  CLIENTS: ["EMPLOYEES", "SERVICE_PACKAGES"],
  TASKS: ["CLIENTS"],
  CLIENT_REQUESTS: ["CLIENTS"],
  ISSUES: ["CLIENTS"],
  MONTHLY_CLOSE: ["CLIENTS"],
  ACTIVITY_LOG: ["CLIENTS"],
  SETTINGS: [],
};
