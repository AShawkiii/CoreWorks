import { describe, expect, it } from "vitest";

import {
  ClientHealth,
  IssueStatus,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import {
  CLIENT_HEALTH_SORT_RANK,
  DEFAULT_SETTINGS,
  ISSUE_OPEN_STATUSES,
  MONTHLY_CLOSE_STAGES,
  PRIORITY_WEIGHTS,
  REQUEST_CLOSED_STATUSES,
  REQUEST_OPEN_STATUSES,
  TASK_CLOSED_STATUSES,
  TASK_OPEN_STATUSES,
} from "@/lib/domain/enums";

describe("priority weights", () => {
  it("matches legacy ENUMS.PRIORITY.weights exactly", () => {
    expect(PRIORITY_WEIGHTS[Priority.LOW]).toBe(1);
    expect(PRIORITY_WEIGHTS[Priority.MEDIUM]).toBe(2);
    expect(PRIORITY_WEIGHTS[Priority.HIGH]).toBe(3);
    expect(PRIORITY_WEIGHTS[Priority.CRITICAL]).toBe(4);
  });

  it("orders strictly, so weighted completion favours important work", () => {
    expect(PRIORITY_WEIGHTS[Priority.CRITICAL]).toBeGreaterThan(
      PRIORITY_WEIGHTS[Priority.HIGH],
    );
    expect(PRIORITY_WEIGHTS[Priority.HIGH]).toBeGreaterThan(
      PRIORITY_WEIGHTS[Priority.MEDIUM],
    );
    expect(PRIORITY_WEIGHTS[Priority.MEDIUM]).toBeGreaterThan(
      PRIORITY_WEIGHTS[Priority.LOW],
    );
  });
});

describe("task status partitions", () => {
  it("treats only Completed and Cancelled as closed", () => {
    expect([...TASK_CLOSED_STATUSES].sort()).toEqual(
      [TaskStatus.CANCELLED, TaskStatus.COMPLETED].sort(),
    );
  });

  it("keeps IN_REVIEW open (audit conflict C1)", () => {
    // The CoreWorks brief omitted In Review; legacy has it, so it stays.
    expect(TASK_OPEN_STATUSES).toContain(TaskStatus.IN_REVIEW);
  });

  it("partitions every status exactly once", () => {
    const all = Object.values(TaskStatus);
    const partitioned = [...TASK_OPEN_STATUSES, ...TASK_CLOSED_STATUSES];

    expect(partitioned).toHaveLength(all.length);
    expect(new Set(partitioned).size).toBe(all.length);
    for (const status of all) expect(partitioned).toContain(status);
  });
});

describe("request status partitions", () => {
  it("treats only Requested and Partially Received as open", () => {
    expect([...REQUEST_OPEN_STATUSES].sort()).toEqual(
      [RequestStatus.PARTIALLY_RECEIVED, RequestStatus.REQUESTED].sort(),
    );
  });

  it("partitions every status exactly once", () => {
    const all = Object.values(RequestStatus);
    const partitioned = [...REQUEST_OPEN_STATUSES, ...REQUEST_CLOSED_STATUSES];

    expect(partitioned).toHaveLength(all.length);
    expect(new Set(partitioned).size).toBe(all.length);
  });
});

describe("issue status partitions", () => {
  it("treats Open and In Progress as open", () => {
    expect([...ISSUE_OPEN_STATUSES].sort()).toEqual(
      [IssueStatus.IN_PROGRESS, IssueStatus.OPEN].sort(),
    );
  });
});

describe("client health sort rank", () => {
  it("orders most urgent first, matching legacy healthSortRank", () => {
    expect(CLIENT_HEALTH_SORT_RANK[ClientHealth.DELAYED]).toBe(0);
    expect(CLIENT_HEALTH_SORT_RANK[ClientHealth.AT_RISK]).toBe(1);
    expect(CLIENT_HEALTH_SORT_RANK[ClientHealth.ON_TRACK]).toBe(2);
    expect(CLIENT_HEALTH_SORT_RANK[ClientHealth.ON_HOLD]).toBe(3);
  });

  it("ranks Delayed at zero — the falsy value legacy guarded against", () => {
    // Legacy used hasOwnProperty rather than `rank[health] || 99` precisely
    // because 0 is falsy and would demote the most urgent clients. Phase 3's
    // healthSortRank port must preserve that; this pins the value it depends on.
    expect(CLIENT_HEALTH_SORT_RANK[ClientHealth.DELAYED]).toBe(0);
    expect(Boolean(CLIENT_HEALTH_SORT_RANK[ClientHealth.DELAYED])).toBe(false);
  });

  it("ranks every health state distinctly", () => {
    const ranks = Object.values(ClientHealth).map(
      (health) => CLIENT_HEALTH_SORT_RANK[health],
    );
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("default settings", () => {
  it("uses the thresholds the legacy CODE uses, not the ones its docs claim", () => {
    // audit D2: architecture.md §7 said Delayed at >= 1 overdue task, which
    // would make the At Risk branch unreachable. HealthLogic.gs uses 3.
    expect(DEFAULT_SETTINGS.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT).toBe(3);
    expect(DEFAULT_SETTINGS.HEALTH_AT_RISK_OVERDUE_COUNT).toBe(1);
    expect(DEFAULT_SETTINGS.HEALTH_AT_RISK_DUE_SOON_DAYS).toBe(3);
  });

  it("keeps Delayed strictly harder to reach than At Risk", () => {
    expect(
      DEFAULT_SETTINGS.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT,
    ).toBeGreaterThan(DEFAULT_SETTINGS.HEALTH_AT_RISK_OVERDUE_COUNT);
  });

  it("matches the remaining legacy constants", () => {
    expect(DEFAULT_SETTINGS.REQUEST_STALE_DAYS).toBe(15);
    expect(DEFAULT_SETTINGS.MONTHLY_CLOSE_DEFAULT_DUE_DAY).toBe(5);
    expect(DEFAULT_SETTINGS.WORKLOAD_OVERLOAD_MARGIN).toBe(0);
  });
});

describe("monthly close stages", () => {
  it("has the 18 legacy stages in column order", () => {
    expect(MONTHLY_CLOSE_STAGES).toHaveLength(18);
    expect(MONTHLY_CLOSE_STAGES[0]).toBe("Sales");
    expect(MONTHLY_CLOSE_STAGES[17]).toBe("Final Approval");
  });

  it("lists each stage once", () => {
    expect(new Set(MONTHLY_CLOSE_STAGES).size).toBe(
      MONTHLY_CLOSE_STAGES.length,
    );
  });
});
