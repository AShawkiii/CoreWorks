/**
 * Date and period rules.
 *
 * Port of legacy `apps-script/utils/DateLogic.gs` (audit §6.4) — the most
 * reused module in the system. All arithmetic is whole-day: `toDateOnly`
 * strips time first, so a task due today is never "0.4 days overdue".
 *
 * Legacy returned `''` for "no value"; this returns `null`. That is the only
 * difference, and it is representational.
 */

import {
  MONTH_END_CLOSING_SERVICE_AREA,
  REQUEST_CLOSED_STATUSES,
  TASK_CLOSED_STATUSES,
  type DaysWaitingBucket,
} from "@/lib/domain/enums";
import type { Frequency, RequestStatus, TaskStatus } from "@/lib/domain/enums";
import type { Period } from "@/lib/domain/types";

/** Strips time-of-day so date subtraction always yields whole days. */
export function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day difference `a - b`, positive when `a` is later. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (toDateOnly(a).getTime() - toDateOnly(b).getTime()) / MS_PER_DAY,
  );
}

export function isTaskClosed(status: TaskStatus): boolean {
  return TASK_CLOSED_STATUSES.includes(status);
}

/**
 * Legacy `computeDaysRemaining`. Null when the task has no due date or is
 * closed; otherwise `dueDate - today`, which goes negative once overdue.
 */
export function computeDaysRemaining(
  dueDate: Date | null,
  status: TaskStatus,
  today: Date,
): number | null {
  if (!dueDate) return null;
  if (isTaskClosed(status)) return null;
  return daysBetween(dueDate, today);
}

/**
 * Legacy `computeDaysOverdue`. Zero unless the task is open, has a due date,
 * and that date has passed — then the positive number of days.
 *
 * Note it returns 0 rather than null for a closed task, exactly as legacy
 * did: the KPIs count `computeDaysOverdue(...) > 0`, so a closed task must
 * compare as not-overdue rather than as missing.
 */
export function computeDaysOverdue(
  dueDate: Date | null,
  status: TaskStatus,
  today: Date,
): number {
  if (!dueDate) return 0;
  if (isTaskClosed(status)) return 0;
  const diff = daysBetween(today, dueDate);
  return diff > 0 ? diff : 0;
}

/**
 * Legacy `computeDaysWaiting`. While the request is outstanding, counts from
 * the requested date to today. Once closed it FREEZES at
 * `receivedDate - requestedDate`, and is null if closed with no received date
 * recorded — the elapsed time is genuinely unknown in that case, and
 * substituting today would keep a settled request ageing forever.
 */
export function computeDaysWaiting(
  requestedDate: Date | null,
  status: RequestStatus,
  today: Date,
  receivedDate: Date | null,
): number | null {
  if (!requestedDate) return null;

  if (REQUEST_CLOSED_STATUSES.includes(status)) {
    return receivedDate ? daysBetween(receivedDate, requestedDate) : null;
  }

  return daysBetween(today, requestedDate);
}

/** Legacy `bucketDaysWaiting`. Null passes through. */
export function bucketDaysWaiting(
  days: number | null,
): DaysWaitingBucket | null {
  if (days === null) return null;
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

/**
 * Legacy `frequencyHitsPeriod` — whether a template produces a task for the
 * given "YYYY-MM" period.
 *
 * Daily, Weekly, and Monthly all fire every period: V1 represents sub-monthly
 * work as one recurring monthly checklist item rather than literal daily
 * rows. That is a deliberate legacy simplification, preserved here; true
 * sub-monthly recurrence is a future enhancement, not a silent change.
 */
export function frequencyHitsPeriod(
  frequency: Frequency,
  period: Period,
  isFirstPeriodForClient: boolean,
): boolean {
  if (frequency === "ONE_TIME") return Boolean(isFirstPeriodForClient);

  const month = Number.parseInt(String(period).split("-")[1] ?? "", 10);

  if (frequency === "QUARTERLY") return [3, 6, 9, 12].includes(month);
  if (frequency === "ANNUALLY") return month === 12;

  // DAILY, WEEKLY, MONTHLY
  return true;
}

/**
 * Legacy `computeTaskDueDate`.
 *
 * Month-End Closing work is due on `monthlyCloseDueDay` of the month AFTER
 * the period — you cannot close a month from inside it. Everything else is
 * due on the last calendar day of the period's own month, plus the
 * template's typical duration as a completion buffer.
 */
export function computeTaskDueDate(
  period: Period,
  serviceArea: string,
  typicalDurationDays: number,
  monthlyCloseDueDay: number,
): Date {
  const parts = String(period).split("-");
  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10); // 1-based

  if (serviceArea === MONTH_END_CLOSING_SERVICE_AREA) {
    // `month` is 1-based, so passing it to a 0-based Date constructor lands
    // on the following month — which is the intent.
    return new Date(year, month, monthlyCloseDueDay || 5);
  }

  // Day 0 of the 1-based `month` is the last day of that month.
  const lastDayOfPeriodMonth = new Date(year, month, 0);
  const due = new Date(lastDayOfPeriodMonth.getTime());
  due.setDate(due.getDate() + (typicalDurationDays || 0));
  return due;
}

/** Legacy `formatPeriod` — "YYYY-MM" for a date. */
export function formatPeriod(date: Date): Period {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}
