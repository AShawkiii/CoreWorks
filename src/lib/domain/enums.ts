/**
 * Canonical domain vocabulary.
 *
 * Transcribed from legacy `apps-script/config/Enums.gs` (audit §5). The values
 * marked code-significant there are compared by identity in business logic, so
 * this file is the single place they are defined — never inline a status
 * string in a component or query.
 *
 * Display labels live in `labels.ts`. Renaming a label is safe; changing an
 * identifier here is a schema migration.
 */

import {
  ClientHealth,
  CloseStageStatus,
  CloseStatus,
  ContractStatus,
  Frequency,
  IssueSeverity,
  IssueStatus,
  Priority,
  ReportingFrequency,
  RequestStatus,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";

/**
 * Priority weights — legacy `ENUMS.PRIORITY.weights`.
 *
 * Load-bearing in three distinct places (audit §5), not merely display
 * metadata: weighted completion %, issue-surfacing severity order, and
 * client-detail issue ordering. An unrecognised priority weighs 1
 * (legacy `ProgressLogic.gs::computeWeightedCompletion`).
 */
export const PRIORITY_WEIGHTS: Record<Priority, number> = {
  [Priority.LOW]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.HIGH]: 3,
  [Priority.CRITICAL]: 4,
};

export const DEFAULT_PRIORITY_WEIGHT = 1;

/** Legacy `ENUMS.TASK_STATUS.closed` — statuses that end a task's life. */
export const TASK_CLOSED_STATUSES: readonly TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.CANCELLED,
] as const;

/** Legacy `ENUMS.TASK_STATUS.open`. Includes IN_REVIEW (audit conflict C1). */
export const TASK_OPEN_STATUSES: readonly TaskStatus[] = [
  TaskStatus.NOT_STARTED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.WAITING_CLIENT,
  TaskStatus.BLOCKED,
  TaskStatus.IN_REVIEW,
] as const;

/** Legacy `ENUMS.ISSUE_STATUS.open`. */
export const ISSUE_OPEN_STATUSES: readonly IssueStatus[] = [
  IssueStatus.OPEN,
  IssueStatus.IN_PROGRESS,
] as const;

export const ISSUE_CLOSED_STATUSES: readonly IssueStatus[] = [
  IssueStatus.RESOLVED,
  IssueStatus.CANCELLED,
] as const;

/** Legacy `ENUMS.REQUEST_STATUS.open`. */
export const REQUEST_OPEN_STATUSES: readonly RequestStatus[] = [
  RequestStatus.REQUESTED,
  RequestStatus.PARTIALLY_RECEIVED,
] as const;

/** Legacy `REQUEST_CLOSED_STATUSES` in `utils/DateLogic.gs`. */
export const REQUEST_CLOSED_STATUSES: readonly RequestStatus[] = [
  RequestStatus.RECEIVED,
  RequestStatus.NOT_AVAILABLE,
  RequestStatus.CANCELLED,
] as const;

/**
 * Client-health sort order — legacy `CLIENT_HEALTH_SORT_RANK`
 * (audit §6.6). Most urgent first.
 */
export const CLIENT_HEALTH_SORT_RANK: Record<ClientHealth, number> = {
  [ClientHealth.DELAYED]: 0,
  [ClientHealth.AT_RISK]: 1,
  [ClientHealth.ON_TRACK]: 2,
  [ClientHealth.ON_HOLD]: 3,
};

export const UNRANKED_HEALTH_RANK = 99;

/** Days-waiting buckets — legacy `ENUMS.DAYS_WAITING_BUCKET` (audit §6.4). */
export const DAYS_WAITING_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
export type DaysWaitingBucket = (typeof DAYS_WAITING_BUCKETS)[number];

/**
 * Default thresholds — legacy `config/Constants.gs`. These are only seed
 * values: once an organization exists, `OrganizationSetting` is the live
 * source of truth and these are the fallback when a key is absent, exactly
 * as legacy `getSetting()` behaved (audit §6.1, conflict C6).
 *
 * Note `HEALTH_DELAYED_TOTAL_OVERDUE_COUNT = 3`, not 1. Legacy
 * `architecture.md` §7 misstated this; the code is authoritative
 * (audit defect D2). The legacy constant `HEALTH_DELAYED_OVERDUE_COUNT`
 * was vestigial and is deliberately not carried over.
 */
export const DEFAULT_SETTINGS = {
  HEALTH_DELAYED_TOTAL_OVERDUE_COUNT: 3,
  HEALTH_AT_RISK_OVERDUE_COUNT: 1,
  HEALTH_AT_RISK_DUE_SOON_DAYS: 3,
  REQUEST_STALE_DAYS: 15,
  MONTHLY_CLOSE_DEFAULT_DUE_DAY: 5,
  WORKLOAD_OVERLOAD_MARGIN: 0,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

/** Settings category, mirroring legacy SETTINGS."Setting Category". */
export const SETTING_CATEGORY: Record<SettingKey, string> = {
  HEALTH_DELAYED_TOTAL_OVERDUE_COUNT: "HEALTH",
  HEALTH_AT_RISK_OVERDUE_COUNT: "HEALTH",
  HEALTH_AT_RISK_DUE_SOON_DAYS: "HEALTH",
  REQUEST_STALE_DAYS: "REQUESTS",
  MONTHLY_CLOSE_DEFAULT_DUE_DAY: "MONTHLY_CLOSE",
  WORKLOAD_OVERLOAD_MARGIN: "WORKLOAD",
};

/**
 * The 18 monthly-close stages, in legacy column order
 * (`MONTHLY_CLOSE_STAGE_COLUMNS`, audit §3.1/§6.13). Order is preserved as
 * `MonthlyCloseTask.stageOrder` so the close dashboard renders as before.
 */
export const MONTHLY_CLOSE_STAGES = [
  "Sales",
  "COGS",
  "Expenses",
  "Bank Reconciliation",
  "AP",
  "AR",
  "Inventory",
  "Fixed Assets",
  "Accruals",
  "Prepayments",
  "Payroll",
  "Intercompany",
  "Trial Balance",
  "P&L",
  "Balance Sheet",
  "Cash Flow",
  "Management Review",
  "Final Approval",
] as const;

export type MonthlyCloseStage = (typeof MONTHLY_CLOSE_STAGES)[number];

/** Service area that gets the following-month due date (audit §6.4). */
export const MONTH_END_CLOSING_SERVICE_AREA = "Month-End Closing";

/**
 * Re-exported so the pure domain layer imports its vocabulary from one place
 * and never reaches into the generated Prisma output directly. The generated
 * enums file is a standalone module of plain const objects with no imports,
 * so this carries no Prisma runtime into the domain.
 */
export {
  ClientHealth,
  CloseStageStatus,
  CloseStatus,
  ContractStatus,
  Frequency,
  IssueSeverity,
  IssueStatus,
  Priority,
  ReportingFrequency,
  RequestStatus,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
};
