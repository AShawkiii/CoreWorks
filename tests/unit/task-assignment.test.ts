import { describe, expect, it } from "vitest";

import { Priority, TaskStatus } from "@/lib/domain/enums";
import { taskBelongsToMember } from "@/lib/domain/task";
import type { DomainMember, DomainTask } from "@/lib/domain/types";
import { buildTeamDashboardRows } from "@/lib/domain/view-models/team-dashboard";
import { buildTeamPerformanceSection } from "@/lib/domain/view-models/management-report";

/**
 * Assignment matching — audit D4.
 *
 * Legacy joined a task to a person by NAME. Two people sharing a display name
 * each got credited with the other's work, so the team totals exceeded the
 * number of real tasks. Phase 3's DIFF-4 committed CoreWorks to foreign keys;
 * `taskBelongsToMember` is where that lands for the two team view models.
 *
 * The name path is kept and tested because the parity fixtures use it: they
 * mirror legacy rows, which carry no ids, so the harness still compares like
 * for like against the original `.gs`.
 */

const TODAY = new Date(2026, 7, 15);

function member(id: string, name: string, capacity: number | null = 10): DomainMember {
  return { id, name, jobTitle: "Bookkeeper", isActive: true, capacity };
}

function task(overrides: Partial<DomainTask> = {}): DomainTask {
  return {
    id: "t1",
    displayId: "TSK-000001",
    clientId: "c1",
    clientName: "Alpha",
    serviceArea: "Tax",
    taskName: "A task",
    period: null,
    frequency: null,
    assignedToName: null,
    priority: Priority.MEDIUM,
    status: TaskStatus.IN_PROGRESS,
    dueDate: null,
    completionDate: null,
    completionPct: 0,
    reviewStatus: "NOT_REVIEWED" as DomainTask["reviewStatus"],
    ...overrides,
  };
}

describe("taskBelongsToMember", () => {
  const jane = member("m1", "Jane AM");
  const bob = member("m2", "Bob Book");

  it("matches on id when the task carries one", () => {
    const t = task({ assignedToId: "m1", assignedToName: "Jane AM" });
    expect(taskBelongsToMember(t, jane)).toBe(true);
    expect(taskBelongsToMember(t, bob)).toBe(false);
  });

  it("trusts the id over a stale or wrong name", () => {
    // The name is denormalised for display; the id is the truth.
    const t = task({ assignedToId: "m1", assignedToName: "Bob Book" });
    expect(taskBelongsToMember(t, jane)).toBe(true);
    expect(taskBelongsToMember(t, bob)).toBe(false);
  });

  it("treats an explicitly unassigned task as nobody's", () => {
    const t = task({ assignedToId: null, assignedToName: null });
    expect(taskBelongsToMember(t, jane)).toBe(false);
    expect(taskBelongsToMember(t, bob)).toBe(false);
  });

  it("does not credit a null id to a member with a null-ish name", () => {
    const t = task({ assignedToId: null, assignedToName: "Jane AM" });
    // The id is present-but-null, so the id path decides: unassigned.
    expect(taskBelongsToMember(t, jane)).toBe(false);
  });

  it("falls back to the name when the task carries no id at all", () => {
    // This is the legacy shape the parity fixtures use.
    const t = task({ assignedToName: "Jane AM" });
    expect(t.assignedToId).toBeUndefined();
    expect(taskBelongsToMember(t, jane)).toBe(true);
    expect(taskBelongsToMember(t, bob)).toBe(false);
  });
});

describe("audit D4 — two members sharing a display name", () => {
  const twins: DomainMember[] = [
    member("m1", "John Smith"),
    member("m2", "John Smith"),
  ];

  const byId: DomainTask[] = [
    task({ id: "t1", assignedToId: "m1", assignedToName: "John Smith" }),
    task({ id: "t2", assignedToId: "m2", assignedToName: "John Smith" }),
  ];

  it("credits each task to exactly one member on the Team Dashboard", () => {
    const rows = buildTeamDashboardRows(twins, byId, TODAY, 0);
    expect(rows.map((r) => r.assigned)).toEqual([1, 1]);
    // The whole point: the team total equals the number of real tasks.
    expect(rows.reduce((sum, r) => sum + r.assigned, 0)).toBe(byId.length);
  });

  it("credits each task to exactly one member in Team Performance", () => {
    const rows = buildTeamPerformanceSection(byId, twins, TODAY);
    expect(rows.map((r) => r.tasks)).toEqual([1, 1]);
    expect(rows.reduce((sum, r) => sum + r.tasks, 0)).toBe(byId.length);
  });

  it("double-counts under the legacy name rule, which is why the id rule exists", () => {
    // Same two tasks with no ids — the shape legacy produced. Both members
    // claim both tasks, and the team reports four tasks where there are two.
    const byName: DomainTask[] = [
      task({ id: "t1", assignedToName: "John Smith" }),
      task({ id: "t2", assignedToName: "John Smith" }),
    ];
    const rows = buildTeamDashboardRows(twins, byName, TODAY, 0);
    expect(rows.map((r) => r.assigned)).toEqual([2, 2]);
    expect(rows.reduce((sum, r) => sum + r.assigned, 0)).toBe(
      byName.length * 2,
    );
  });

  it("keeps overload judged per person, not per name", () => {
    const tight = [member("m1", "John Smith", 1), member("m2", "John Smith", 1)];
    const rows = buildTeamDashboardRows(tight, byId, TODAY, 0);
    // One open task each against a capacity of 1 — neither is over.
    expect(rows.map((r) => r.overloaded)).toEqual([false, false]);

    const nameRows = buildTeamDashboardRows(
      tight,
      [task({ id: "t1", assignedToName: "John Smith" }), task({ id: "t2", assignedToName: "John Smith" })],
      TODAY,
      0,
    );
    // Under the name rule both look like they carry two.
    expect(nameRows.map((r) => r.overloaded)).toEqual([true, true]);
  });
});
