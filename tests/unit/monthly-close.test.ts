import { describe, expect, it } from "vitest";

import {
  CloseStageStatus,
  CloseStatus,
  MONTHLY_CLOSE_STAGES,
  TaskStatus,
} from "@/lib/domain/enums";
import {
  buildCloseStages,
  computeCloseCompletion,
  computeCloseStatus,
} from "@/lib/domain/monthly-close";
import { buildMonthlyCloseSummary, orderStages } from "@/lib/domain/view-models/monthly-close-dashboard";
import type { DomainCloseStage } from "@/lib/domain/types";

import { d, makeTask } from "../parity/fixtures";

/**
 * Monthly close (audit §6.13).
 *
 * Legacy expressed these as spreadsheet formulas rather than a `*Logic.gs`
 * module, so there is no legacy JavaScript to diff against. These tests assert
 * the formula semantics directly, case by case:
 *
 *   Completion % = IF(COUNTA(stages)=0, 0,
 *                     COUNTIF(stages,"Completed") / COUNTA(stages))
 *   Close Status = IFS(completion=1,"Closed",
 *                      COUNTIF(stages,"Blocked")>0,"Blocked",
 *                      completion>0,"In Progress",
 *                      TRUE,"Not Started")
 */

function stages(
  statuses: (CloseStageStatus | null)[],
): DomainCloseStage[] {
  return statuses.map((status, index) => ({
    stageName: MONTHLY_CLOSE_STAGES[index] ?? `Stage ${index}`,
    stageOrder: index,
    status,
  }));
}

const S = CloseStageStatus;

describe("buildCloseStages", () => {
  it("creates all 18 legacy stages in column order", () => {
    const built = buildCloseStages(MONTHLY_CLOSE_STAGES);

    expect(built).toHaveLength(18);
    expect(built[0]?.stageName).toBe("Sales");
    expect(built[17]?.stageName).toBe("Final Approval");
    expect(built.map((s) => s.stageOrder)).toEqual(
      Array.from({ length: 18 }, (_, i) => i),
    );
  });

  it("starts every stage Not Started", () => {
    expect(
      buildCloseStages(MONTHLY_CLOSE_STAGES).every(
        (s) => s.status === S.NOT_STARTED,
      ),
    ).toBe(true);
  });
});

describe("computeCloseCompletion", () => {
  it("is 0 with no stages at all — COUNTA=0 guard", () => {
    expect(computeCloseCompletion([])).toBe(0);
  });

  it("is 0 when every stage is blank", () => {
    expect(computeCloseCompletion(stages([null, null, null]))).toBe(0);
  });

  it("is 0 when nothing is completed", () => {
    expect(
      computeCloseCompletion(
        stages([S.NOT_STARTED, S.IN_PROGRESS, S.BLOCKED]),
      ),
    ).toBe(0);
  });

  it("is partial for a partly-done close", () => {
    expect(
      computeCloseCompletion(
        stages([S.COMPLETED, S.COMPLETED, S.NOT_STARTED, S.IN_PROGRESS]),
      ),
    ).toBe(0.5);
  });

  it("is 1 when every stage is completed", () => {
    expect(
      computeCloseCompletion(stages([S.COMPLETED, S.COMPLETED])),
    ).toBe(1);
  });

  it("is 1 across all 18 real stages", () => {
    expect(
      computeCloseCompletion(
        stages(Array.from({ length: 18 }, () => S.COMPLETED)),
      ),
    ).toBe(1);
  });

  it("excludes blank stages from the denominator, exactly as COUNTA did", () => {
    // Legacy quirk, preserved: one Completed stage among seventeen blanks
    // reads 100%. CoreWorks materialises all 18 with an explicit status, so
    // this cannot arise in practice — but imported legacy data behaves as it
    // did in the sheet. See docs/phase3-business-logic.md, DIFF-1.
    const oneTouched = stages([
      S.COMPLETED,
      ...Array.from({ length: 17 }, () => null),
    ]);
    expect(computeCloseCompletion(oneTouched)).toBe(1);

    const allExplicit = stages([
      S.COMPLETED,
      ...Array.from({ length: 17 }, () => S.NOT_STARTED),
    ]);
    expect(computeCloseCompletion(allExplicit)).toBeCloseTo(1 / 18);
  });
});

describe("computeCloseStatus", () => {
  it("is Not Started for no stages, all blank, or none begun", () => {
    expect(computeCloseStatus([])).toBe(CloseStatus.NOT_STARTED);
    expect(computeCloseStatus(stages([null, null]))).toBe(
      CloseStatus.NOT_STARTED,
    );
    expect(computeCloseStatus(stages([S.NOT_STARTED, S.NOT_STARTED]))).toBe(
      CloseStatus.NOT_STARTED,
    );
  });

  it("is In Progress once something is completed but not everything", () => {
    expect(
      computeCloseStatus(stages([S.COMPLETED, S.NOT_STARTED])),
    ).toBe(CloseStatus.IN_PROGRESS);
  });

  it("is Blocked when any stage is blocked and the close is unfinished", () => {
    expect(computeCloseStatus(stages([S.BLOCKED, S.NOT_STARTED]))).toBe(
      CloseStatus.BLOCKED,
    );
    expect(computeCloseStatus(stages([S.COMPLETED, S.BLOCKED]))).toBe(
      CloseStatus.BLOCKED,
    );
  });

  it("prefers Blocked over In Progress — a stuck close must surface", () => {
    const mostlyDone = stages([
      S.COMPLETED,
      S.COMPLETED,
      S.COMPLETED,
      S.BLOCKED,
    ]);
    expect(computeCloseStatus(mostlyDone)).toBe(CloseStatus.BLOCKED);
  });

  it("is Closed only at 100%", () => {
    expect(computeCloseStatus(stages([S.COMPLETED, S.COMPLETED]))).toBe(
      CloseStatus.CLOSED,
    );
  });

  it("checks Closed before Blocked, matching the IFS order", () => {
    // A fully-completed close has no blocked stage, so this is about the
    // ordering being preserved rather than a reachable conflict.
    const allDone = stages(Array.from({ length: 18 }, () => S.COMPLETED));
    expect(computeCloseStatus(allDone)).toBe(CloseStatus.CLOSED);
  });

  it("treats Waiting Client as neither complete nor blocked", () => {
    expect(
      computeCloseStatus(stages([S.WAITING_CLIENT, S.NOT_STARTED])),
    ).toBe(CloseStatus.NOT_STARTED);
    expect(
      computeCloseStatus(stages([S.COMPLETED, S.WAITING_CLIENT])),
    ).toBe(CloseStatus.IN_PROGRESS);
  });
});

describe("orderStages", () => {
  it("restores legacy column order regardless of input order", () => {
    const shuffled = [...buildCloseStages(MONTHLY_CLOSE_STAGES)].reverse();
    expect(orderStages(shuffled).map((s) => s.stageName)).toEqual([
      ...MONTHLY_CLOSE_STAGES,
    ]);
  });
});

describe("buildMonthlyCloseSummary", () => {
  const TODAY = d("2026-08-15");

  it("is all zeros for a period with no tasks", () => {
    expect(buildMonthlyCloseSummary([], TODAY)).toEqual({
      completionPct: 0,
      completed: 0,
      pending: 0,
      overdue: 0,
      waitingClient: 0,
      blocked: 0,
    });
  });

  it("counts every task in the period, not only Month-End Closing ones", () => {
    // Legacy is explicit: "the close" spans every deliverable due that period.
    const summary = buildMonthlyCloseSummary(
      [
        makeTask({ serviceArea: "Month-End Closing", status: TaskStatus.COMPLETED }),
        makeTask({ serviceArea: "Bookkeeping", status: TaskStatus.COMPLETED }),
      ],
      TODAY,
    );
    expect(summary.completed).toBe(2);
    expect(summary.completionPct).toBe(1);
  });

  it("excludes Blocked and Waiting Client from pending", () => {
    // They have their own cards; counting them as pending too would
    // double-report and hide that the work is stuck rather than unstarted.
    const summary = buildMonthlyCloseSummary(
      [
        makeTask({ status: TaskStatus.NOT_STARTED }),
        makeTask({ status: TaskStatus.IN_PROGRESS }),
        makeTask({ status: TaskStatus.IN_REVIEW }),
        makeTask({ status: TaskStatus.BLOCKED }),
        makeTask({ status: TaskStatus.WAITING_CLIENT }),
      ],
      TODAY,
    );

    expect(summary.pending).toBe(3);
    expect(summary.blocked).toBe(1);
    expect(summary.waitingClient).toBe(1);
  });

  it("excludes cancelled tasks entirely", () => {
    const summary = buildMonthlyCloseSummary(
      [
        makeTask({ status: TaskStatus.COMPLETED }),
        makeTask({ status: TaskStatus.CANCELLED }),
      ],
      TODAY,
    );
    expect(summary.completionPct).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it("counts overdue open tasks", () => {
    const summary = buildMonthlyCloseSummary(
      [
        makeTask({ status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-01") }),
        makeTask({ status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-20") }),
        makeTask({ status: TaskStatus.COMPLETED, dueDate: d("2026-01-01") }),
      ],
      TODAY,
    );
    expect(summary.overdue).toBe(1);
  });
});
