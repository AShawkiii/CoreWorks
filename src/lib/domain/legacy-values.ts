import {
  ClientHealth,
  CloseStageStatus,
  ContractStatus,
  EntityType,
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
import {
  CLIENT_HEALTH_LABELS,
  CLOSE_STAGE_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  FREQUENCY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/domain/labels";

/**
 * Reading and writing legacy cell values — pure, no I/O.
 *
 * Every function here obeys one rule from migration-plan §4:
 *
 * > *"Enum values validate against audit §5. An unrecognized value is a
 * > rejection, never a silent coercion."*
 *
 * So each parser returns `null` for anything it does not recognise, and the
 * importer turns that into a **Failed** row naming the column and the value.
 * The alternative — falling back to a default — is how a migration quietly
 * marks forty tasks Not Started because their status column had a trailing
 * space in the export.
 *
 * The label tables are the same ones the UI renders from, so a value that
 * round-trips through export and back is guaranteed to match. That is what
 * makes CSV a real rollback path (migration-plan §5) rather than a lossy one.
 */

/** Blank means absent, not invalid. Legacy leaves optional cells empty. */
export function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * Reverse-maps a label table.
 *
 * Case-insensitive and whitespace-trimmed, because those are differences a
 * spreadsheet introduces by accident. Nothing else is forgiven: "Completed "
 * parses, "complete" does not.
 */
function fromLabels<T extends string>(
  labels: Record<T, string>,
): (value: string) => T | null {
  const index = new Map<string, T>(
    (Object.entries(labels) as [T, string][]).map(([key, label]) => [
      label.trim().toLowerCase(),
      key,
    ]),
  );

  return (value: string) => {
    if (isBlank(value)) return null;
    return index.get(value.trim().toLowerCase()) ?? null;
  };
}

export const parseTaskStatus = fromLabels<TaskStatus>(TASK_STATUS_LABELS);
export const parsePriority = fromLabels<Priority>(PRIORITY_LABELS);
export const parseClientHealth = fromLabels<ClientHealth>(CLIENT_HEALTH_LABELS);
export const parseContractStatus =
  fromLabels<ContractStatus>(CONTRACT_STATUS_LABELS);
export const parseRequestStatus =
  fromLabels<RequestStatus>(REQUEST_STATUS_LABELS);
export const parseIssueSeverity =
  fromLabels<IssueSeverity>(ISSUE_SEVERITY_LABELS);
export const parseIssueStatus = fromLabels<IssueStatus>(ISSUE_STATUS_LABELS);
export const parseReviewStatus = fromLabels<ReviewStatus>(REVIEW_STATUS_LABELS);
export const parseFrequency = fromLabels<Frequency>(FREQUENCY_LABELS);
export const parseTaskCategory = fromLabels<TaskCategory>(TASK_CATEGORY_LABELS);
export const parseCloseStageStatus = fromLabels<CloseStageStatus>(
  CLOSE_STAGE_STATUS_LABELS,
);

/**
 * `CLIENTS.Reporting Frequency`.
 *
 * No label table exists for this enum — it is stored but never rendered as a
 * badge — so the labels are declared here, matching the legacy sample data
 * (`'Reporting Frequency': 'Monthly'`).
 */
export const REPORTING_FREQUENCY_LABELS: Record<ReportingFrequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

export const parseReportingFrequency = fromLabels<ReportingFrequency>(
  REPORTING_FREQUENCY_LABELS,
);

/**
 * `ACTIVITY_LOG.Entity Type`.
 *
 * Legacy wrote these as free text from `ActivityLogger` call sites — "Client",
 * "Task", "Issue", "Client Request". Matched loosely on the underscore-free
 * form so both `CLIENT_REQUEST` and `Client Request` resolve.
 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  CLIENT: "Client",
  USER: "User",
  TASK: "Task",
  TASK_TEMPLATE: "Task Template",
  CLIENT_REQUEST: "Client Request",
  ISSUE: "Issue",
  MONTHLY_CLOSE: "Monthly Close",
  SERVICE: "Service",
  SERVICE_PACKAGE: "Service Package",
  ORGANIZATION: "Organization",
  SYSTEM: "System",
};

const entityTypeIndex = new Map<string, EntityType>();
for (const [key, label] of Object.entries(ENTITY_TYPE_LABELS) as [
  EntityType,
  string,
][]) {
  entityTypeIndex.set(label.toLowerCase(), key);
  entityTypeIndex.set(key.toLowerCase(), key);
  entityTypeIndex.set(key.toLowerCase().replaceAll("_", " "), key);
}

export function parseEntityType(value: string): EntityType | null {
  if (isBlank(value)) return null;
  return entityTypeIndex.get(value.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/**
 * `Yes` / `No`, as legacy wrote every boolean column
 * (`'Active?': 'Yes'` throughout the sample data).
 *
 * `TRUE`/`FALSE` and `1`/`0` are also accepted: a spreadsheet that has had a
 * checkbox applied to the column exports those instead, and rejecting a file
 * for that would be pedantry rather than safety — the intent is unambiguous.
 * Anything else is `null`, not `false`.
 */
export function parseYesNo(value: string): boolean | null {
  const normalised = value.trim().toLowerCase();
  if (normalised === "") return null;
  if (["yes", "y", "true", "1"].includes(normalised)) return true;
  if (["no", "n", "false", "0"].includes(normalised)) return false;
  return null;
}

export function formatYesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value ? "Yes" : "No";
}

/**
 * A legacy date cell.
 *
 * Accepts `YYYY-MM-DD` — the form legacy wrote (`'Start Date': '2025-11-01'`)
 * and the form Sheets exports for a date-formatted cell — plus the ISO
 * timestamp a cell with a time component produces.
 *
 * **Day-first and month-first formats are deliberately refused.** `03/04/2026`
 * is the 3rd of April in one locale and the 4th of March in another, and there
 * is nothing in a CSV to say which. Guessing would silently move deadlines by
 * up to eleven months; refusing tells the operator to re-export with an
 * unambiguous format.
 *
 * Constructed in UTC so a due date does not shift a day on a server west of
 * Greenwich.
 */
export function parseLegacyDate(value: string): Date | null {
  const raw = value.trim();
  if (raw === "") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects the 31st of February, which the constructor would roll forward.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatLegacyDate(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

/** A whole number. Blank is null; anything non-numeric is null, not zero. */
export function parseLegacyInt(value: string): number | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * A completion percentage.
 *
 * Legacy stored these as fractions in 0..1 (audit §6.2) but a spreadsheet cell
 * formatted as a percentage exports as `45%` or sometimes `45`. All three are
 * accepted and normalised to a fraction:
 *
 *  - `0.45` → 0.45
 *  - `45%`  → 0.45
 *  - `45`   → 0.45
 *
 * The bare-number case is the only inference here, and it is safe because the
 * ranges cannot overlap: a stored fraction is never above 1, and a percentage
 * below 1 is indistinguishable from a fraction and means the same thing either
 * way. Out of range is null.
 */
export function parseLegacyPercent(value: string): number | null {
  const raw = value.trim();
  if (raw === "") return null;

  const hasSign = raw.endsWith("%");
  const numeric = hasSign ? raw.slice(0, -1).trim() : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(numeric)) return null;

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  const fraction = hasSign || parsed > 1 ? parsed / 100 : parsed;
  return fraction > 1 ? null : fraction;
}

export function formatLegacyPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  // Written back as the fraction legacy stored, so a round trip is exact.
  return String(Math.round(value * 10000) / 10000);
}

/**
 * A period, `YYYY-MM`.
 *
 * `MONTHLY_CLOSE.Month` and `TASKS.Period` both use it. A full date is
 * accepted and truncated, since a spreadsheet often stores the month as its
 * first day.
 */
export function parseLegacyPeriod(value: string): string | null {
  const raw = value.trim();
  if (raw === "") return null;

  const match = /^(\d{4})-(\d{2})(?:-\d{2})?(?:[T ].*)?$/.exec(raw);
  if (!match) return null;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return `${match[1]}-${match[2]}`;
}

/** Free text. Blank becomes null so a column of empty strings is not stored. */
export function parseText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
