import { describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/lib/domain/enums";
import { computeDaysWaiting } from "@/lib/domain/date";
import {
  buildClientDetailViewModel,
  buildClientsListViewModel,
} from "@/lib/domain/view-models/clients";
import {
  buildClientHealthRows,
  buildControlCenterKpis,
  buildSurfacedIssueRows,
} from "@/lib/domain/view-models/control-center";
import { buildManagementReport } from "@/lib/domain/view-models/management-report";
import type {
  DomainClient,
  DomainIssue,
  DomainRequest,
  DomainTask,
} from "@/lib/domain/types";

import {
  d,
  makeClient,
  makeIssue,
  makeMember,
  makeRequest,
  makeTask,
  toLegacyClient,
  toLegacyEmployee,
  toLegacyIssue,
  toLegacyRequest,
  toLegacyTask,
} from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

const TODAY = d("2026-08-15");

// ---------------------------------------------------------------------------
// Control Center — audit §8.2. The fourteen KPIs.
// ---------------------------------------------------------------------------

const ccCtx = loadLegacyContext([...LEGACY_MODULES.controlCenter]);

const legacyKpis = legacyFn<
  (
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[],
    issues: Record<string, unknown>[],
    today: Date,
  ) => { key: string; label: string; value: number; format: string }[]
>(ccCtx, "buildControlCenterKpis");

const legacyHealthRows = legacyFn<
  (
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[],
    issues: Record<string, unknown>[],
    today: Date,
  ) => Record<string, unknown>[]
>(ccCtx, "buildClientHealthRows");

const legacySurfacedRows = legacyFn<
  (issues: Record<string, unknown>[], today: Date) => Record<string, unknown>[]
>(ccCtx, "buildSurfacedIssueRows");

interface Scenario {
  name: string;
  clients: DomainClient[];
  tasks: DomainTask[];
  issues: DomainIssue[];
}

const scenarios: Scenario[] = [
  { name: "completely empty", clients: [], tasks: [], issues: [] },
  {
    name: "clients across every contract status and health",
    clients: [
      makeClient({ id: "c1", name: "Alpha", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.ON_TRACK, weightedCompletionPct: 1 }),
      makeClient({ id: "c2", name: "Beta", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.AT_RISK, weightedCompletionPct: 0.5 }),
      makeClient({ id: "c3", name: "Gamma", contractStatus: ContractStatus.ONBOARDING, health: ClientHealth.ON_TRACK, weightedCompletionPct: 0 }),
      makeClient({ id: "c4", name: "Delta", contractStatus: ContractStatus.ON_HOLD, health: ClientHealth.ON_HOLD, weightedCompletionPct: 0.25 }),
      makeClient({ id: "c5", name: "Epsilon", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.DELAYED, weightedCompletionPct: 0.75 }),
      makeClient({ id: "c6", name: "Zeta", contractStatus: ContractStatus.COMPLETED, health: ClientHealth.ON_TRACK, weightedCompletionPct: 1 }),
      makeClient({ id: "c7", name: "Eta", contractStatus: ContractStatus.CANCELLED, health: ClientHealth.ON_HOLD, weightedCompletionPct: 0 }),
    ],
    tasks: [],
    issues: [],
  },
  {
    name: "tasks in every status, some overdue",
    clients: [makeClient({ id: "c1", name: "Alpha" })],
    tasks: [
      makeTask({ clientId: "c1", status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-10") }),
      makeTask({ clientId: "c1", status: TaskStatus.IN_PROGRESS, dueDate: d("2026-08-20") }),
      makeTask({ clientId: "c1", status: TaskStatus.WAITING_CLIENT, dueDate: d("2026-08-01") }),
      makeTask({ clientId: "c1", status: TaskStatus.BLOCKED, dueDate: null }),
      makeTask({ clientId: "c1", status: TaskStatus.IN_REVIEW, dueDate: d("2026-08-14") }),
      makeTask({ clientId: "c1", status: TaskStatus.COMPLETED, dueDate: d("2026-01-01") }),
      makeTask({ clientId: "c1", status: TaskStatus.CANCELLED, dueDate: d("2026-01-01") }),
    ],
    issues: [],
  },
  {
    name: "issues in every severity and status",
    clients: [makeClient({ id: "c1", name: "Alpha" })],
    tasks: [],
    issues: [
      makeIssue({ displayId: "I1", clientId: "c1", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN, dateRaised: d("2026-08-01") }),
      makeIssue({ displayId: "I2", clientId: "c1", severity: IssueSeverity.HIGH, status: IssueStatus.IN_PROGRESS, dateRaised: d("2026-08-02") }),
      makeIssue({ displayId: "I3", clientId: "c1", severity: IssueSeverity.MEDIUM, status: IssueStatus.OPEN, dateRaised: d("2026-08-03") }),
      makeIssue({ displayId: "I4", clientId: "c1", severity: IssueSeverity.LOW, status: IssueStatus.OPEN, deadline: d("2026-08-01"), dateRaised: d("2026-08-04") }),
      makeIssue({ displayId: "I5", clientId: "c1", severity: IssueSeverity.CRITICAL, status: IssueStatus.RESOLVED, dateRaised: d("2026-08-05") }),
    ],
  },
  {
    name: "clients with no tasks alongside clients with tasks",
    clients: [
      makeClient({ id: "c1", name: "HasTasks", contractStatus: ContractStatus.ACTIVE }),
      makeClient({ id: "c2", name: "NoTasks", contractStatus: ContractStatus.ACTIVE }),
    ],
    tasks: [
      makeTask({ clientId: "c1", status: TaskStatus.WAITING_CLIENT, dueDate: d("2026-08-01") }),
    ],
    issues: [
      makeIssue({ displayId: "I1", clientId: "c1", status: IssueStatus.OPEN }),
    ],
  },
  {
    name: "health sort ordering with a name tiebreak",
    clients: [
      makeClient({ id: "c1", name: "Zulu", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.AT_RISK }),
      makeClient({ id: "c2", name: "Alpha", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.AT_RISK }),
      makeClient({ id: "c3", name: "Mike", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.DELAYED }),
      makeClient({ id: "c4", name: "Bravo", contractStatus: ContractStatus.ACTIVE, health: ClientHealth.ON_TRACK }),
      makeClient({ id: "c5", name: "Oscar", contractStatus: ContractStatus.ON_HOLD, health: ClientHealth.ON_HOLD }),
    ],
    tasks: [],
    issues: [],
  },
];

describe("parity: buildControlCenterKpis — all 14", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const mine = buildControlCenterKpis(
        scenario.clients,
        scenario.tasks,
        scenario.issues,
        TODAY,
      );
      const theirs = legacyKpis(
        scenario.clients.map(toLegacyClient),
        scenario.tasks.map(toLegacyTask),
        scenario.issues.map(toLegacyIssue),
        TODAY,
      );

      // Structural comparison: same keys, same order, same labels, same values.
      expect(mine.map((k) => k.key)).toEqual(theirs.map((k) => k.key));
      expect(mine.map((k) => k.label)).toEqual(theirs.map((k) => k.label));
      expect(mine.map((k) => k.format)).toEqual(theirs.map((k) => k.format));

      for (const [index, kpi] of mine.entries()) {
        expect(kpi.value, `KPI ${kpi.key}`).toBeCloseTo(
          theirs[index]?.value as number,
          10,
        );
      }
    });
  }

  it("emits exactly the fourteen keys the brief lists", () => {
    const keys = buildControlCenterKpis([], [], [], TODAY).map((k) => k.key);
    expect(keys).toEqual([
      "totalClients",
      "activeClients",
      "onboardingClients",
      "onHoldClients",
      "clientsAtRisk",
      "clientsDelayed",
      "overallCompletionPct",
      "openTasks",
      "overdueTasks",
      "tasksCompleted",
      "waitingOnClient",
      "blockedTasks",
      "openIssues",
      "issuesNeedingAttention",
    ]);
  });

  it("keeps Overall Completion % a plain mean of per-client percentages", () => {
    // Audit §8.2 flags this: a 3-task client and a 300-task client weigh the
    // same. Preserved rather than silently "improved".
    const kpis = buildControlCenterKpis(
      [
        makeClient({ id: "a", name: "A", weightedCompletionPct: 1 }),
        makeClient({ id: "b", name: "B", weightedCompletionPct: 0 }),
      ],
      [],
      [],
      TODAY,
    );
    expect(kpis.find((k) => k.key === "overallCompletionPct")?.value).toBe(0.5);
  });
});

describe("parity: buildClientHealthRows", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const mine = buildClientHealthRows(
        scenario.clients,
        scenario.tasks,
        scenario.issues,
        TODAY,
      );
      const theirs = legacyHealthRows(
        scenario.clients.map(toLegacyClient),
        scenario.tasks.map(toLegacyTask),
        scenario.issues.map(toLegacyIssue),
        TODAY,
      );

      expect(mine.map((r) => r.clientName)).toEqual(
        theirs.map((r) => r.clientName),
      );
      expect(mine.map((r) => r.overdueTasks)).toEqual(
        theirs.map((r) => r.overdueTasks),
      );
      expect(mine.map((r) => r.waitingOnClient)).toEqual(
        theirs.map((r) => r.waitingOnClient),
      );
      expect(mine.map((r) => r.openIssues)).toEqual(
        theirs.map((r) => r.openIssues),
      );
      expect(mine.map((r) => r.completionPct)).toEqual(
        theirs.map((r) => r.completionPct),
      );
    });
  }

  it("shows only Active clients (audit conflict C5)", () => {
    const rows = buildClientHealthRows(
      scenarios[1]?.clients ?? [],
      [],
      [],
      TODAY,
    );
    expect(rows.map((r) => r.clientName).sort()).toEqual([
      "Alpha",
      "Beta",
      "Epsilon",
    ]);
  });
});

describe("parity: buildSurfacedIssueRows", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const mine = buildSurfacedIssueRows(scenario.issues, TODAY);
      const theirs = legacySurfacedRows(
        scenario.issues.map(toLegacyIssue),
        TODAY,
      );

      expect(mine.map((r) => r.issueDisplayId)).toEqual(
        theirs.map((r) => r.issueId),
      );
      expect(mine.map((r) => r.daysOpen)).toEqual(theirs.map((r) => r.daysOpen));
    });
  }
});

// ---------------------------------------------------------------------------
// Clients view models
// ---------------------------------------------------------------------------

const clientsCtx = loadLegacyContext([...LEGACY_MODULES.clientsViewModel]);

const legacyClientsList = legacyFn<
  (clients: Record<string, unknown>[]) => Record<string, unknown>[]
>(clientsCtx, "buildClientsListViewModel");

const legacyClientDetail = legacyFn<
  (
    clientId: string,
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[],
    issues: Record<string, unknown>[],
    requests: Record<string, unknown>[],
    today: Date,
  ) => Record<string, unknown> | null
>(clientsCtx, "buildClientDetailViewModel");

describe("parity: buildClientsListViewModel", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const mine = buildClientsListViewModel(scenario.clients);
      const theirs = legacyClientsList(scenario.clients.map(toLegacyClient));

      expect(mine.map((r) => r.clientName)).toEqual(
        theirs.map((r) => r.clientName),
      );
      expect(mine.map((r) => r.completionPct)).toEqual(
        theirs.map((r) => r.completionPct),
      );
    });
  }

  it("includes non-Active clients, unlike the health table", () => {
    const rows = buildClientsListViewModel(scenarios[1]?.clients ?? []);
    expect(rows).toHaveLength(7);
  });
});

describe("parity: buildClientDetailViewModel", () => {
  const client = makeClient({
    id: "c1",
    displayId: "CL-0001",
    name: "Alpha",
    simpleCompletionPct: 0.4,
    weightedCompletionPct: 0.6,
  });

  const tasks = [
    makeTask({ clientId: "c1", displayId: "T1", status: TaskStatus.IN_PROGRESS, dueDate: d("2026-08-20"), priority: Priority.HIGH }),
    makeTask({ clientId: "c1", displayId: "T2", status: TaskStatus.NOT_STARTED, dueDate: null }),
    makeTask({ clientId: "c1", displayId: "T3", status: TaskStatus.COMPLETED, dueDate: d("2026-08-01") }),
    makeTask({ clientId: "c1", displayId: "T4", status: TaskStatus.IN_REVIEW, dueDate: d("2026-08-16") }),
    makeTask({ clientId: "c2", displayId: "T5", status: TaskStatus.IN_PROGRESS, dueDate: d("2026-08-02") }),
  ];

  const issues = [
    makeIssue({ clientId: "c1", displayId: "I1", severity: IssueSeverity.LOW, status: IssueStatus.OPEN }),
    makeIssue({ clientId: "c1", displayId: "I2", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN }),
    makeIssue({ clientId: "c1", displayId: "I3", severity: IssueSeverity.HIGH, status: IssueStatus.RESOLVED }),
    makeIssue({ clientId: "c2", displayId: "I4", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN }),
  ];

  const requests: DomainRequest[] = [
    makeRequest({ clientId: "c1", displayId: "R1", requestedDate: d("2026-08-01"), status: RequestStatus.REQUESTED }),
    makeRequest({ clientId: "c1", displayId: "R2", requestedDate: d("2026-07-01"), status: RequestStatus.PARTIALLY_RECEIVED }),
    makeRequest({ clientId: "c1", displayId: "R3", requestedDate: d("2026-06-01"), status: RequestStatus.RECEIVED, receivedDate: d("2026-06-10") }),
    makeRequest({ clientId: "c2", displayId: "R4", requestedDate: d("2026-08-01") }),
  ];

  function legacyRows() {
    return legacyClientDetail(
      "c1",
      [client].map(toLegacyClient),
      tasks.map(toLegacyTask),
      issues.map(toLegacyIssue),
      requests.map((request) =>
        toLegacyRequest(
          request,
          computeDaysWaiting(
            request.requestedDate,
            request.status,
            TODAY,
            request.receivedDate,
          ),
        ),
      ),
      TODAY,
    );
  }

  it("returns null for an unknown client, exactly as legacy does", () => {
    expect(
      buildClientDetailViewModel("nope", [client], tasks, issues, requests, TODAY),
    ).toBeNull();
    expect(
      legacyClientDetail(
        "nope",
        [client].map(toLegacyClient),
        [],
        [],
        [],
        TODAY,
      ),
    ).toBeNull();
  });

  it("matches on scalar fields", () => {
    const mine = buildClientDetailViewModel(
      "c1",
      [client],
      tasks,
      issues,
      requests,
      TODAY,
    );
    const theirs = legacyRows();

    expect(mine?.clientName).toBe(theirs?.clientName);
    expect(mine?.simpleCompletionPct).toBe(theirs?.simpleCompletionPct);
    expect(mine?.weightedCompletionPct).toBe(theirs?.weightedCompletionPct);
  });

  it("shows only open tasks, soonest due first, no-date last", () => {
    const mine = buildClientDetailViewModel(
      "c1",
      [client],
      tasks,
      issues,
      requests,
      TODAY,
    );
    const theirs = legacyRows();

    const theirTasks = theirs?.tasks as Record<string, unknown>[];
    expect(mine?.tasks.map((t) => t.taskDisplayId)).toEqual(
      theirTasks.map((t) => t.taskId),
    );
    expect(mine?.tasks.map((t) => t.daysRemaining ?? "")).toEqual(
      theirTasks.map((t) => t.daysRemaining),
    );
  });

  it("shows only open issues, most severe first", () => {
    const mine = buildClientDetailViewModel(
      "c1",
      [client],
      tasks,
      issues,
      requests,
      TODAY,
    );
    const theirIssues = legacyRows()?.issues as Record<string, unknown>[];

    expect(mine?.issues.map((i) => i.issueDisplayId)).toEqual(
      theirIssues.map((i) => i.issueId),
    );
  });

  it("shows only open requests, longest waiting first", () => {
    const mine = buildClientDetailViewModel(
      "c1",
      [client],
      tasks,
      issues,
      requests,
      TODAY,
    );
    const theirRequests = legacyRows()?.requests as Record<string, unknown>[];

    expect(mine?.requests.map((r) => r.requestDisplayId)).toEqual(
      theirRequests.map((r) => r.requestId),
    );
    expect(mine?.requests.map((r) => r.daysWaiting)).toEqual(
      theirRequests.map((r) => r.daysWaiting),
    );
  });
});

// ---------------------------------------------------------------------------
// Management Report — audit §8.6
// ---------------------------------------------------------------------------

const reportCtx = loadLegacyContext([...LEGACY_MODULES.managementReport]);

const legacyReport = legacyFn<
  (
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[],
    issues: Record<string, unknown>[],
    requests: Record<string, unknown>[],
    employees: Record<string, unknown>[],
    today: Date,
  ) => Record<string, unknown>
>(reportCtx, "buildManagementReport");

describe("parity: buildManagementReport", () => {
  const members = [
    makeMember({ name: "Jane AM", jobTitle: "Account Manager", capacity: 10 }),
    makeMember({ name: "Bob Book", jobTitle: "Bookkeeper", capacity: 0 }),
    makeMember({ name: "Idle Ian", jobTitle: "Analyst", capacity: null }),
  ];

  const clients = [
    makeClient({ id: "c1", name: "Alpha", health: ClientHealth.ON_TRACK, weightedCompletionPct: 0.9 }),
    makeClient({ id: "c2", name: "Beta", health: ClientHealth.ON_TRACK, weightedCompletionPct: 0.95 }),
    makeClient({ id: "c3", name: "Gamma", health: ClientHealth.AT_RISK }),
    makeClient({ id: "c4", name: "Delta", health: ClientHealth.DELAYED }),
    makeClient({ id: "c5", name: "Epsilon", health: ClientHealth.ON_HOLD }),
  ];

  const tasks = [
    makeTask({ clientId: "c1", clientName: "Alpha", assignedToName: "Jane AM", status: TaskStatus.COMPLETED }),
    makeTask({ clientId: "c1", clientName: "Alpha", assignedToName: "Jane AM", status: TaskStatus.NOT_STARTED, dueDate: d("2026-08-01") }),
    makeTask({ clientId: "c2", clientName: "Beta", assignedToName: "Bob Book", status: TaskStatus.BLOCKED, taskName: "Stuck task" }),
    makeTask({ clientId: "c3", clientName: "Gamma", assignedToName: "Bob Book", status: TaskStatus.CANCELLED }),
  ];

  const issues = [
    makeIssue({ clientId: "c4", clientName: "Delta", title: "Bad data", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN }),
    makeIssue({ clientId: "c3", clientName: "Gamma", severity: IssueSeverity.HIGH, status: IssueStatus.OPEN }),
  ];

  const requests = [
    makeRequest({ clientId: "c1", clientName: "Alpha", title: "Old ask", requestedDate: d("2026-07-01") }),
    makeRequest({ clientId: "c2", clientName: "Beta", requestedDate: d("2026-08-14") }),
  ];

  it("matches every section", () => {
    const mine = buildManagementReport(
      clients,
      tasks,
      issues,
      requests,
      members,
      15,
      TODAY,
    );

    const theirs = legacyReport(
      clients.map(toLegacyClient),
      tasks.map(toLegacyTask),
      issues.map(toLegacyIssue),
      requests.map((request) =>
        toLegacyRequest(
          request,
          computeDaysWaiting(
            request.requestedDate,
            request.status,
            TODAY,
            request.receivedDate,
          ),
        ),
      ),
      members.map(toLegacyEmployee),
      TODAY,
    );

    expect(mine.clientPerformance).toEqual(theirs.clientPerformance);
    expect(mine.operationalRisks).toEqual(theirs.operationalRisks);

    const theirTeam = theirs.teamPerformance as Record<string, unknown>[];
    expect(mine.teamPerformance.map((r) => r.member)).toEqual(
      theirTeam.map((r) => r.employee),
    );
    expect(mine.teamPerformance.map((r) => r.tasks)).toEqual(
      theirTeam.map((r) => r.tasks),
    );
    expect(mine.teamPerformance.map((r) => r.overdue)).toEqual(
      theirTeam.map((r) => r.overdue),
    );

    expect(mine.managementAttention).toEqual(theirs.managementAttention);
  });

  it("orders attention items by category and caps at 15", () => {
    const manyClients = Array.from({ length: 20 }, (_, i) =>
      makeClient({
        id: `x${i}`,
        name: `Delayed ${String(i).padStart(2, "0")}`,
        health: ClientHealth.DELAYED,
      }),
    );

    const report = buildManagementReport(
      manyClients,
      [],
      [],
      [],
      [],
      15,
      TODAY,
    );
    expect(report.managementAttention).toHaveLength(15);
    expect(
      report.managementAttention.every((i) => i.type === "Client Delayed"),
    ).toBe(true);
  });

  it("handles a completely empty organization", () => {
    const mine = buildManagementReport([], [], [], [], [], 15, TODAY);
    const theirs = legacyReport([], [], [], [], [], TODAY);

    expect(mine.clientPerformance).toEqual(theirs.clientPerformance);
    expect(mine.operationalRisks).toEqual(theirs.operationalRisks);
    expect(mine.managementAttention).toEqual(theirs.managementAttention);
  });
});
