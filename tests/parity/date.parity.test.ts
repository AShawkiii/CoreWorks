import { describe, expect, it } from "vitest";

import {
  bucketDaysWaiting,
  computeDaysOverdue,
  computeDaysRemaining,
  computeDaysWaiting,
  computeTaskDueDate,
  daysBetween,
  formatPeriod,
  frequencyHitsPeriod,
} from "@/lib/domain/date";
import {
  Frequency,
  RequestStatus,
  TaskStatus,
} from "@/lib/domain/enums";

import {
  d,
  FREQUENCY_TO_LEGACY,
  REQUEST_STATUS_TO_LEGACY,
  TASK_STATUS_TO_LEGACY,
} from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

/**
 * Differential parity for utils/DateLogic.gs (audit §6.4).
 *
 * Legacy returns `''` where the port returns `null`; `norm` collapses that one
 * representational difference so every other divergence is a real failure.
 */
const ctx = loadLegacyContext([...LEGACY_MODULES.dateLogic]);

const legacyDaysRemaining = legacyFn<
  (due: Date | "", status: string, today: Date) => number | ""
>(ctx, "computeDaysRemaining");
const legacyDaysOverdue = legacyFn<
  (due: Date | "", status: string, today: Date) => number
>(ctx, "computeDaysOverdue");
const legacyDaysWaiting = legacyFn<
  (
    requested: Date | "",
    status: string,
    today: Date,
    received: Date | "",
  ) => number | ""
>(ctx, "computeDaysWaiting");
const legacyBucket = legacyFn<(days: number | "") => string>(
  ctx,
  "bucketDaysWaiting",
);
const legacyFrequencyHits = legacyFn<
  (frequency: string, period: string, isFirst: boolean) => boolean
>(ctx, "frequencyHitsPeriod");
const legacyDueDate = legacyFn<
  (period: string, area: string, duration: number, closeDay: number) => Date
>(ctx, "computeTaskDueDate");
const legacyFormatPeriod = legacyFn<(date: Date) => string>(
  ctx,
  "formatPeriod",
);
const legacyDaysBetween = legacyFn<(a: Date, b: Date) => number>(
  ctx,
  "daysBetween",
);

const norm = <T>(value: T | ""): T | null =>
  value === "" ? null : (value as T);

const TODAY = d("2026-08-15");

describe("parity: daysBetween", () => {
  const cases: [string, string][] = [
    ["2026-08-15", "2026-08-15"],
    ["2026-08-16", "2026-08-15"],
    ["2026-08-15", "2026-08-16"],
    ["2026-09-01", "2026-08-01"],
    ["2027-01-01", "2026-01-01"],
    ["2026-03-01", "2026-02-28"],
  ];

  it.each(cases)("%s - %s", (a, b) => {
    expect(daysBetween(d(a), d(b))).toBe(legacyDaysBetween(d(a), d(b)));
  });
});

describe("parity: computeDaysRemaining", () => {
  const statuses = Object.values(TaskStatus);
  const dueDates: (Date | null)[] = [
    null,
    d("2026-08-10"),
    d("2026-08-15"),
    d("2026-08-20"),
  ];

  for (const status of statuses) {
    for (const dueDate of dueDates) {
      it(`${status} / due ${dueDate ? formatPeriod(dueDate) : "none"}`, () => {
        const mine = computeDaysRemaining(dueDate, status, TODAY);
        const theirs = norm(
          legacyDaysRemaining(
            dueDate ?? "",
            TASK_STATUS_TO_LEGACY[status],
            TODAY,
          ),
        );
        expect(mine).toEqual(theirs);
      });
    }
  }
});

describe("parity: computeDaysOverdue", () => {
  const statuses = Object.values(TaskStatus);

  // Required boundary coverage: 0, 1, 2, and >= 3 days overdue.
  const dueDates: (Date | null)[] = [
    null,
    d("2026-08-15"), // due today  -> 0
    d("2026-08-14"), // 1 day
    d("2026-08-13"), // 2 days
    d("2026-08-12"), // 3 days
    d("2026-08-05"), // 10 days
    d("2026-08-20"), // future
  ];

  for (const status of statuses) {
    for (const dueDate of dueDates) {
      it(`${status} / due ${dueDate ? dueDate.toDateString() : "none"}`, () => {
        const mine = computeDaysOverdue(dueDate, status, TODAY);
        const theirs = legacyDaysOverdue(
          dueDate ?? "",
          TASK_STATUS_TO_LEGACY[status],
          TODAY,
        );
        expect(mine).toBe(theirs);
      });
    }
  }

  it("returns 0 for a closed task even when its due date has long passed", () => {
    // Pinned explicitly: the KPIs count `> 0`, so a completed task must
    // compare as not-overdue rather than as missing.
    expect(
      computeDaysOverdue(d("2026-01-01"), TaskStatus.COMPLETED, TODAY),
    ).toBe(0);
    expect(
      computeDaysOverdue(d("2026-01-01"), TaskStatus.CANCELLED, TODAY),
    ).toBe(0);
  });
});

describe("parity: computeDaysWaiting", () => {
  const statuses = Object.values(RequestStatus);
  const requested: (Date | null)[] = [null, d("2026-08-01"), d("2026-08-15")];
  const received: (Date | null)[] = [null, d("2026-08-05")];

  for (const status of statuses) {
    for (const req of requested) {
      for (const rec of received) {
        it(`${status} / requested ${req ? req.toDateString() : "none"} / received ${rec ? rec.toDateString() : "none"}`, () => {
          const mine = computeDaysWaiting(req, status, TODAY, rec);
          const theirs = norm(
            legacyDaysWaiting(
              req ?? "",
              REQUEST_STATUS_TO_LEGACY[status],
              TODAY,
              rec ?? "",
            ),
          );
          expect(mine).toEqual(theirs);
        });
      }
    }
  }
});

describe("parity: bucketDaysWaiting", () => {
  const values: (number | null)[] = [
    null, 0, 1, 3, 4, 7, 8, 14, 15, 16, 100,
  ];

  it.each(values)("bucket(%s)", (days) => {
    const mine = bucketDaysWaiting(days);
    const theirs = norm(legacyBucket(days ?? ""));
    expect(mine).toEqual(theirs);
  });
});

describe("parity: frequencyHitsPeriod", () => {
  const frequencies = Object.values(Frequency);
  const periods = [
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-06",
    "2026-09",
    "2026-11",
    "2026-12",
  ];

  for (const frequency of frequencies) {
    for (const period of periods) {
      for (const isFirst of [true, false]) {
        it(`${frequency} / ${period} / first=${isFirst}`, () => {
          expect(frequencyHitsPeriod(frequency, period, isFirst)).toBe(
            legacyFrequencyHits(
              FREQUENCY_TO_LEGACY[frequency],
              period,
              isFirst,
            ),
          );
        });
      }
    }
  }
});

describe("parity: computeTaskDueDate", () => {
  const periods = ["2026-01", "2026-02", "2026-06", "2026-11", "2026-12"];
  const areas = ["Month-End Closing", "Bookkeeping", "P&L"];
  const durations = [0, 1, 3, 5];

  for (const period of periods) {
    for (const area of areas) {
      for (const duration of durations) {
        it(`${period} / ${area} / +${duration}d`, () => {
          const mine = computeTaskDueDate(period, area, duration, 5);
          const theirs = legacyDueDate(period, area, duration, 5);
          expect(mine.getTime()).toBe(theirs.getTime());
        });
      }
    }
  }

  it("rolls a December period's month-end close into the next January", () => {
    // Year rollover is the case a naive month+1 gets wrong.
    const due = computeTaskDueDate("2026-12", "Month-End Closing", 0, 5);
    expect(due.getFullYear()).toBe(2027);
    expect(due.getMonth()).toBe(0);
    expect(due.getDate()).toBe(5);
  });

  it("handles February in a leap year", () => {
    const due = computeTaskDueDate("2028-02", "Bookkeeping", 0, 5);
    expect(due.getMonth()).toBe(1);
    expect(due.getDate()).toBe(29);
  });
});

describe("parity: formatPeriod", () => {
  const dates = ["2026-01-01", "2026-09-30", "2026-12-31", "2027-10-05"];

  it.each(dates)("formatPeriod(%s)", (iso) => {
    expect(formatPeriod(d(iso))).toBe(legacyFormatPeriod(d(iso)));
  });
});
