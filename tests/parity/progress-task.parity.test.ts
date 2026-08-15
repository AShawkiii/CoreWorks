import { describe, expect, it } from "vitest";

import { Priority, TaskStatus } from "@/lib/domain/enums";
import {
  computeNextDeadline,
  computeSimpleCompletion,
  computeWeightedCompletion,
} from "@/lib/domain/progress";
import { isTaskOpen, nextStatusAllowed } from "@/lib/domain/task";
import type { DomainTask } from "@/lib/domain/types";

import { d, makeTask, TASK_STATUS_TO_LEGACY, toLegacyTask } from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

/**
 * Differential parity for tasks/ProgressLogic.gs (audit §6.2) and
 * tasks/TaskLogic.gs (audit §6.3).
 */
const ctx = loadLegacyContext([...LEGACY_MODULES.progressLogic]);

const legacySimple = legacyFn<
  (tasks: Record<string, unknown>[]) => {
    completed: number;
    total: number;
    pct: number;
  }
>(ctx, "computeSimpleCompletion");

const legacyWeighted = legacyFn<
  (
    tasks: Record<string, unknown>[],
    weights: Record<string, number>,
  ) => { completedWeight: number; totalWeight: number; pct: number }
>(ctx, "computeWeightedCompletion");

const legacyNextDeadline = legacyFn<
  (tasks: Record<string, unknown>[]) => Date | ""
>(ctx, "computeNextDeadline");

const legacyIsTaskOpen = legacyFn<(status: string) => boolean>(
  ctx,
  "isTaskOpen",
);
const legacyNextStatusAllowed = legacyFn<
  (current: string, target: string) => boolean
>(ctx, "nextStatusAllowed");

const LEGACY_WEIGHTS = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function bothWays(tasks: DomainTask[]) {
  return { domain: tasks, legacy: tasks.map(toLegacyTask) };
}

describe("parity: isTaskOpen", () => {
  it.each(Object.values(TaskStatus))("%s", (status) => {
    expect(isTaskOpen(status)).toBe(
      legacyIsTaskOpen(TASK_STATUS_TO_LEGACY[status]),
    );
  });
});

describe("parity: task status state machine (full matrix)", () => {
  const statuses = Object.values(TaskStatus);

  for (const from of statuses) {
    for (const to of statuses) {
      it(`${from} -> ${to}`, () => {
        expect(nextStatusAllowed(from, to)).toBe(
          legacyNextStatusAllowed(
            TASK_STATUS_TO_LEGACY[from],
            TASK_STATUS_TO_LEGACY[to],
          ),
        );
      });
    }
  }

  it("keeps the three rules that matter", () => {
    expect(nextStatusAllowed(TaskStatus.NOT_STARTED, TaskStatus.COMPLETED)).toBe(
      false,
    );
    expect(
      nextStatusAllowed(TaskStatus.WAITING_CLIENT, TaskStatus.COMPLETED),
    ).toBe(false);
    for (const to of statuses) {
      if (to === TaskStatus.CANCELLED) continue;
      expect(nextStatusAllowed(TaskStatus.CANCELLED, to)).toBe(false);
    }
  });

  it("keeps In Review reachable and exitable (audit conflict C1)", () => {
    expect(nextStatusAllowed(TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW)).toBe(
      true,
    );
    expect(nextStatusAllowed(TaskStatus.IN_REVIEW, TaskStatus.COMPLETED)).toBe(
      true,
    );
    expect(isTaskOpen(TaskStatus.IN_REVIEW)).toBe(true);
  });
});

describe("parity: completion percentages", () => {
  const scenarios: [string, DomainTask[]][] = [
    ["no tasks at all", []],
    [
      "only cancelled tasks",
      [
        makeTask({ status: TaskStatus.CANCELLED }),
        makeTask({ status: TaskStatus.CANCELLED, priority: Priority.CRITICAL }),
      ],
    ],
    [
      "all completed",
      [
        makeTask({ status: TaskStatus.COMPLETED }),
        makeTask({ status: TaskStatus.COMPLETED, priority: Priority.HIGH }),
      ],
    ],
    [
      "none completed",
      [
        makeTask({ status: TaskStatus.NOT_STARTED }),
        makeTask({ status: TaskStatus.IN_PROGRESS }),
      ],
    ],
    [
      "partially complete, mixed priorities",
      [
        makeTask({ status: TaskStatus.COMPLETED, priority: Priority.CRITICAL }),
        makeTask({ status: TaskStatus.NOT_STARTED, priority: Priority.LOW }),
        makeTask({ status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM }),
        makeTask({ status: TaskStatus.IN_REVIEW, priority: Priority.HIGH }),
      ],
    ],
    [
      "cancelled excluded from both numerator and denominator",
      [
        makeTask({ status: TaskStatus.COMPLETED, priority: Priority.HIGH }),
        makeTask({ status: TaskStatus.CANCELLED, priority: Priority.CRITICAL }),
      ],
    ],
    [
      "every status represented once",
      Object.values(TaskStatus).map((status) => makeTask({ status })),
    ],
    [
      "In Review counts as outstanding, not complete",
      [
        makeTask({ status: TaskStatus.IN_REVIEW, priority: Priority.CRITICAL }),
        makeTask({ status: TaskStatus.COMPLETED, priority: Priority.LOW }),
      ],
    ],
  ];

  for (const [name, tasks] of scenarios) {
    it(`simple: ${name}`, () => {
      const { domain, legacy } = bothWays(tasks);
      expect(computeSimpleCompletion(domain)).toEqual(legacySimple(legacy));
    });

    it(`weighted: ${name}`, () => {
      const { domain, legacy } = bothWays(tasks);
      expect(computeWeightedCompletion(domain)).toEqual(
        legacyWeighted(legacy, LEGACY_WEIGHTS),
      );
    });
  }

  it("weights Critical work 4x Low, so priority actually moves the number", () => {
    const critical = computeWeightedCompletion([
      makeTask({ status: TaskStatus.COMPLETED, priority: Priority.CRITICAL }),
      makeTask({ status: TaskStatus.NOT_STARTED, priority: Priority.LOW }),
    ]);
    const low = computeWeightedCompletion([
      makeTask({ status: TaskStatus.COMPLETED, priority: Priority.LOW }),
      makeTask({ status: TaskStatus.NOT_STARTED, priority: Priority.CRITICAL }),
    ]);

    expect(critical.pct).toBeCloseTo(4 / 5);
    expect(low.pct).toBeCloseTo(1 / 5);
  });

  it("never divides by zero", () => {
    expect(computeSimpleCompletion([]).pct).toBe(0);
    expect(computeWeightedCompletion([]).pct).toBe(0);
  });
});

describe("parity: computeNextDeadline", () => {
  const scenarios: [string, DomainTask[]][] = [
    ["no tasks", []],
    [
      "no due dates",
      [makeTask({ dueDate: null }), makeTask({ dueDate: null })],
    ],
    [
      "only closed tasks have dates",
      [
        makeTask({ status: TaskStatus.COMPLETED, dueDate: d("2026-08-01") }),
        makeTask({ status: TaskStatus.CANCELLED, dueDate: d("2026-08-02") }),
      ],
    ],
    [
      "earliest open date wins",
      [
        makeTask({ status: TaskStatus.IN_PROGRESS, dueDate: d("2026-09-01") }),
        makeTask({ status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-20") }),
        makeTask({ status: TaskStatus.BLOCKED, dueDate: d("2026-10-01") }),
      ],
    ],
    [
      "a closed earlier date is ignored in favour of an open later one",
      [
        makeTask({ status: TaskStatus.COMPLETED, dueDate: d("2026-01-01") }),
        makeTask({ status: TaskStatus.IN_PROGRESS, dueDate: d("2026-08-20") }),
      ],
    ],
    [
      "In Review still counts as open",
      [makeTask({ status: TaskStatus.IN_REVIEW, dueDate: d("2026-08-18") })],
    ],
  ];

  for (const [name, tasks] of scenarios) {
    it(name, () => {
      const { domain, legacy } = bothWays(tasks);
      const mine = computeNextDeadline(domain);
      const theirs = legacyNextDeadline(legacy);

      if (theirs === "") {
        expect(mine).toBeNull();
      } else {
        expect(mine?.getTime()).toBe(new Date(theirs).getTime());
      }
    });
  }
});
