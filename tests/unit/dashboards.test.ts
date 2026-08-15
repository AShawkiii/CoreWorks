import { describe, expect, it } from "vitest";

import { Priority, TaskStatus } from "@/lib/domain/enums";
import {
  buildClientTaskSummary,
  buildServiceAreaProgress,
  buildUpcomingDeadlines,
} from "@/lib/domain/view-models/client-dashboard";
import { buildTeamDashboardRows } from "@/lib/domain/view-models/team-dashboard";

import { d, makeMember, makeTask } from "../parity/fixtures";

/**
 * Client and Team dashboards (audit §8.4, §8.5).
 *
 * Legacy kept this logic inside the sheet-writing engines rather than a pure
 * module, so there is no legacy JavaScript to diff against — these assert the
 * engine behaviour directly.
 */

const TODAY = d("2026-08-15");

describe("buildClientTaskSummary", () => {
  it("is all zeros for a client with no tasks", () => {
    expect(buildClientTaskSummary([], TODAY)).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      notStarted: 0,
      waitingClient: 0,
      blocked: 0,
      overdue: 0,
    });
  });

  it("counts each status and excludes cancelled from the total", () => {
    const summary = buildClientTaskSummary(
      [
        makeTask({ status: TaskStatus.NOT_STARTED }),
        makeTask({ status: TaskStatus.IN_PROGRESS }),
        makeTask({ status: TaskStatus.WAITING_CLIENT }),
        makeTask({ status: TaskStatus.BLOCKED }),
        makeTask({ status: TaskStatus.IN_REVIEW }),
        makeTask({ status: TaskStatus.COMPLETED }),
        makeTask({ status: TaskStatus.CANCELLED }),
      ],
      TODAY,
    );

    expect(summary.total).toBe(6);
    expect(summary.notStarted).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.waitingClient).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it("counts only open overdue tasks", () => {
    const summary = buildClientTaskSummary(
      [
        makeTask({ status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-14") }),
        makeTask({ status: TaskStatus.COMPLETED, dueDate: d("2026-01-01") }),
        makeTask({ status: TaskStatus.CANCELLED, dueDate: d("2026-01-01") }),
      ],
      TODAY,
    );
    expect(summary.overdue).toBe(1);
  });
});

describe("buildServiceAreaProgress", () => {
  it("returns nothing for no tasks", () => {
    expect(buildServiceAreaProgress([])).toEqual([]);
  });

  it("groups by service area alphabetically with per-area completion", () => {
    const progress = buildServiceAreaProgress([
      makeTask({ serviceArea: "P&L", status: TaskStatus.COMPLETED }),
      makeTask({ serviceArea: "Bookkeeping", status: TaskStatus.COMPLETED }),
      makeTask({ serviceArea: "Bookkeeping", status: TaskStatus.NOT_STARTED }),
    ]);

    expect(progress.map((p) => p.serviceArea)).toEqual(["Bookkeeping", "P&L"]);
    expect(progress[0]?.completionPct).toBe(0.5);
    expect(progress[1]?.completionPct).toBe(1);
  });

  it("groups tasks with no service area under Unspecified rather than dropping them", () => {
    const progress = buildServiceAreaProgress([
      makeTask({ serviceArea: "", status: TaskStatus.COMPLETED }),
    ]);
    expect(progress[0]?.serviceArea).toBe("Unspecified");
  });

  it("excludes cancelled tasks from area progress", () => {
    const progress = buildServiceAreaProgress([
      makeTask({ serviceArea: "AP", status: TaskStatus.COMPLETED }),
      makeTask({ serviceArea: "AP", status: TaskStatus.CANCELLED }),
    ]);
    expect(progress[0]?.completionPct).toBe(1);
  });
});

describe("buildUpcomingDeadlines", () => {
  it("lists open dated tasks soonest first", () => {
    const deadlines = buildUpcomingDeadlines(
      [
        makeTask({ taskName: "Later", status: TaskStatus.NOT_STARTED, dueDate: d("2026-09-01") }),
        makeTask({ taskName: "Sooner", status: TaskStatus.IN_PROGRESS, dueDate: d("2026-08-20") }),
        makeTask({ taskName: "No date", status: TaskStatus.NOT_STARTED, dueDate: null }),
        makeTask({ taskName: "Done", status: TaskStatus.COMPLETED, dueDate: d("2026-08-01") }),
      ],
      TODAY,
    );

    expect(deadlines.map((x) => x.taskName)).toEqual(["Sooner", "Later"]);
    expect(deadlines[0]?.daysRemaining).toBe(5);
  });

  it("respects the limit", () => {
    const tasks = Array.from({ length: 20 }, () =>
      makeTask({ status: TaskStatus.NOT_STARTED, dueDate: d("2026-09-01") }),
    );
    expect(buildUpcomingDeadlines(tasks, TODAY, 5)).toHaveLength(5);
  });
});

describe("buildTeamDashboardRows", () => {
  const members = [
    makeMember({ name: "Busy Bee", jobTitle: "Bookkeeper", capacity: 2 }),
    makeMember({ name: "Zero Cap", jobTitle: "Analyst", capacity: 0 }),
    makeMember({ name: "No Cap", jobTitle: "Advisor", capacity: null }),
    makeMember({ name: "Idle", jobTitle: "Viewer", capacity: 5 }),
  ];

  const tasks = [
    makeTask({ assignedToName: "Busy Bee", status: TaskStatus.IN_PROGRESS, priority: Priority.CRITICAL, dueDate: d("2026-08-01") }),
    makeTask({ assignedToName: "Busy Bee", status: TaskStatus.NOT_STARTED }),
    makeTask({ assignedToName: "Busy Bee", status: TaskStatus.IN_REVIEW }),
    makeTask({ assignedToName: "Busy Bee", status: TaskStatus.COMPLETED }),
    makeTask({ assignedToName: "Busy Bee", status: TaskStatus.CANCELLED }),
    makeTask({ assignedToName: "Zero Cap", status: TaskStatus.NOT_STARTED }),
    makeTask({ assignedToName: "No Cap", status: TaskStatus.NOT_STARTED }),
  ];

  const rows = buildTeamDashboardRows(members, tasks, TODAY);
  const row = (name: string) => rows.find((r) => r.memberName === name);

  it("returns one row per member, including members with no work", () => {
    expect(rows).toHaveLength(4);
    expect(row("Idle")?.assigned).toBe(0);
    expect(row("Idle")?.completionPct).toBe(0);
    expect(row("Idle")?.overloaded).toBe(false);
  });

  it("excludes cancelled tasks from every count", () => {
    expect(row("Busy Bee")?.assigned).toBe(4);
  });

  it("counts only OPEN critical tasks", () => {
    // A completed critical task is history, not a live risk.
    expect(row("Busy Bee")?.critical).toBe(1);
  });

  it("flags overload against capacity", () => {
    // Busy Bee: 3 open tasks vs capacity 2.
    expect(row("Busy Bee")?.overloaded).toBe(true);
    // Zero Cap: 1 open task vs capacity 0 — zero is a real limit.
    expect(row("Zero Cap")?.overloaded).toBe(true);
    // No Cap: capacity unset, never judged overloaded.
    expect(row("No Cap")?.overloaded).toBe(false);
  });

  it("honours an overload margin", () => {
    const lenient = buildTeamDashboardRows(members, tasks, TODAY, 5);
    expect(lenient.find((r) => r.memberName === "Busy Bee")?.overloaded).toBe(
      false,
    );
  });

  it("computes overdue and completion per member", () => {
    expect(row("Busy Bee")?.overdue).toBe(1);
    expect(row("Busy Bee")?.completionPct).toBe(0.25);
  });
});
