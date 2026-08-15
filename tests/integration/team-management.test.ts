import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  OrgRole,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import { MANAGEMENT_ATTENTION_LIMIT } from "@/lib/domain/view-models/management-report";
import type { OrgContext } from "@/server/context";
import {
  getManagementReport,
  getTeamDashboard,
} from "@/server/services/dashboard";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 9 integration tests — Team Dashboard and Management Report against
 * PostgreSQL.
 *
 * The fixture deliberately includes two members who share a display name, so
 * the audit D4 correction is exercised end to end rather than only in a unit
 * test: under the legacy name rule the team totals would exceed the number of
 * real tasks.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-tm";
const OTHER_SLUG = "test-org-tm-other";
const EMAIL_DOMAIN = "@tm-test.example.com";

const TODAY = new Date(2026, 7, 15);
const daysAgo = (n: number) => new Date(2026, 7, 15 - n);
const daysAhead = (n: number) => new Date(2026, 7, 15 + n);

let ctx: OrgContext;
let otherCtx: OrgContext;
let members: Record<string, string>;
let clients: Record<string, string>;

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, OTHER_SLUG] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: "TM Test Org", slug: SLUG },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  async function addMember(
    key: string,
    displayName: string,
    seq: number,
    capacity: number | null,
  ) {
    const user = await prisma.user.create({
      data: {
        name: displayName,
        email: `${key}${EMAIL_DOMAIN}`,
        passwordHash: "unused",
      },
      select: { id: true, name: true, email: true },
    });
    const member = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        displayId: formatDisplayId("MEMBER", seq),
        role: seq === 1 ? OrgRole.OWNER : OrgRole.ACCOUNTANT,
        jobTitle: "Bookkeeper",
        capacity,
        isActive: true,
      },
      select: { id: true },
    });
    return { member, user };
  }

  // twinA and twinB share a display name — the D4 case.
  const owner = await addMember("owner", "Ada Owner", 1, 5);
  const twinA = await addMember("twin-a", "John Smith", 2, 2);
  const twinB = await addMember("twin-b", "John Smith", 3, 2);
  const unrated = await addMember("unrated", "Nia Unrated", 4, null);

  members = {
    owner: owner.member.id,
    twinA: twinA.member.id,
    twinB: twinB.member.id,
    unrated: unrated.member.id,
  };

  ctx = {
    userId: owner.user.id,
    userEmail: owner.user.email,
    userName: owner.user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: owner.member.id,
    role: OrgRole.OWNER,
  };

  const pkg = await prisma.servicePackage.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });

  const clientSpec = [
    { key: "best", health: ClientHealth.ON_TRACK, pct: 0.9 },
    { key: "good", health: ClientHealth.ON_TRACK, pct: 0.6 },
    { key: "risky", health: ClientHealth.AT_RISK, pct: 0.4 },
    { key: "late", health: ClientHealth.DELAYED, pct: 0.1 },
    { key: "paused", health: ClientHealth.ON_HOLD, pct: 0.3 },
  ];
  clients = {};
  for (const [index, entry] of clientSpec.entries()) {
    const created = await prisma.client.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("CLIENT", index + 1),
        name: `TM ${entry.key}`,
        servicePackageId: pkg.id,
        accountManagerId: owner.member.id,
        startDate: new Date(2026, 0, 1),
        contractStatus:
          entry.health === ClientHealth.ON_HOLD
            ? ContractStatus.ON_HOLD
            : ContractStatus.ACTIVE,
        health: entry.health,
        weightedCompletionPct: entry.pct,
        priority: Priority.MEDIUM,
      },
      select: { id: true },
    });
    clients[entry.key] = created.id;
  }

  const taskSpec: {
    assignee: string | null;
    status: TaskStatus;
    dueDate: Date | null;
    priority: Priority;
    client: string;
  }[] = [
    // twinA: 1 completed, 1 overdue in progress, 1 critical open.
    { assignee: "twinA", status: TaskStatus.COMPLETED, dueDate: daysAgo(20), priority: Priority.MEDIUM, client: "best" },
    { assignee: "twinA", status: TaskStatus.IN_PROGRESS, dueDate: daysAgo(3), priority: Priority.MEDIUM, client: "risky" },
    { assignee: "twinA", status: TaskStatus.NOT_STARTED, dueDate: daysAhead(5), priority: Priority.CRITICAL, client: "late" },
    // twinB: 1 waiting, 1 blocked, 1 cancelled (excluded everywhere).
    { assignee: "twinB", status: TaskStatus.WAITING_CLIENT, dueDate: daysAhead(2), priority: Priority.MEDIUM, client: "good" },
    { assignee: "twinB", status: TaskStatus.BLOCKED, dueDate: daysAgo(1), priority: Priority.HIGH, client: "late" },
    { assignee: "twinB", status: TaskStatus.CANCELLED, dueDate: daysAgo(9), priority: Priority.MEDIUM, client: "good" },
    // unrated: 3 open against a null capacity — can never be flagged.
    { assignee: "unrated", status: TaskStatus.IN_PROGRESS, dueDate: daysAhead(4), priority: Priority.LOW, client: "best" },
    { assignee: "unrated", status: TaskStatus.IN_PROGRESS, dueDate: daysAhead(7), priority: Priority.LOW, client: "good" },
    { assignee: "unrated", status: TaskStatus.NOT_STARTED, dueDate: null, priority: Priority.LOW, client: "good" },
    // Unassigned: belongs to nobody's row.
    { assignee: null, status: TaskStatus.BLOCKED, dueDate: daysAgo(6), priority: Priority.CRITICAL, client: "paused" },
  ];

  for (const [index, entry] of taskSpec.entries()) {
    await prisma.task.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("TASK", index + 1),
        clientId: clients[entry.client]!,
        taskName: `TM task ${index + 1}`,
        serviceArea: "Tax",
        status: entry.status,
        dueDate: entry.dueDate,
        priority: entry.priority,
        assignedToId: entry.assignee ? members[entry.assignee] : null,
      },
    });
  }

  // Soft-deleted: must reach no count.
  await prisma.task.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("TASK", 99),
      clientId: clients.best!,
      taskName: "TM deleted task",
      serviceArea: "Tax",
      status: TaskStatus.BLOCKED,
      dueDate: daysAgo(2),
      priority: Priority.CRITICAL,
      assignedToId: members.twinA,
      deletedAt: new Date(),
    },
  });

  const issueSpec: {
    client: string;
    severity: IssueSeverity;
    status: IssueStatus;
  }[] = [
    { client: "late", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN },
    { client: "risky", severity: IssueSeverity.CRITICAL, status: IssueStatus.IN_PROGRESS },
    { client: "good", severity: IssueSeverity.HIGH, status: IssueStatus.OPEN },
    { client: "best", severity: IssueSeverity.CRITICAL, status: IssueStatus.RESOLVED },
  ];
  for (const [index, entry] of issueSpec.entries()) {
    await prisma.issue.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("ISSUE", index + 1),
        clientId: clients[entry.client]!,
        title: `TM issue ${index + 1}`,
        severity: entry.severity,
        status: entry.status,
        dateRaised: daysAgo(10),
      },
    });
  }

  const requestSpec: { client: string; status: RequestStatus; requested: Date }[] =
    [
      { client: "late", status: RequestStatus.REQUESTED, requested: daysAgo(20) },
      { client: "risky", status: RequestStatus.PARTIALLY_RECEIVED, requested: daysAgo(16) },
      { client: "good", status: RequestStatus.REQUESTED, requested: daysAgo(3) },
      { client: "best", status: RequestStatus.RECEIVED, requested: daysAgo(30) },
    ];
  for (const [index, entry] of requestSpec.entries()) {
    await prisma.clientRequest.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("CLIENT_REQUEST", index + 1),
        clientId: clients[entry.client]!,
        title: `TM request ${index + 1}`,
        status: entry.status,
        requestedDate: entry.requested,
        receivedDate:
          entry.status === RequestStatus.RECEIVED ? daysAgo(2) : null,
        priority: Priority.MEDIUM,
      },
    });
  }

  // A neighbouring organization, for tenancy.
  const otherOrg = await prisma.organization.create({
    data: { name: "TM Other", slug: OTHER_SLUG },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(otherOrg.id);
  const otherUser = await prisma.user.create({
    data: {
      name: "Neighbour Owner",
      email: `neighbour${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true, name: true, email: true },
  });
  const otherMember = await prisma.organizationMember.create({
    data: {
      organizationId: otherOrg.id,
      userId: otherUser.id,
      displayId: formatDisplayId("MEMBER", 1),
      role: OrgRole.OWNER,
      capacity: 1,
      isActive: true,
    },
    select: { id: true },
  });
  const otherPkg = await prisma.servicePackage.create({
    data: {
      organizationId: otherOrg.id,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });
  const otherClient = await prisma.client.create({
    data: {
      organizationId: otherOrg.id,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Neighbour client",
      servicePackageId: otherPkg.id,
      accountManagerId: otherMember.id,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      health: ClientHealth.DELAYED,
      weightedCompletionPct: 0,
      priority: Priority.MEDIUM,
    },
    select: { id: true },
  });
  await prisma.task.create({
    data: {
      organizationId: otherOrg.id,
      displayId: formatDisplayId("TASK", 1),
      clientId: otherClient.id,
      taskName: "Neighbour task",
      serviceArea: "Tax",
      status: TaskStatus.BLOCKED,
      dueDate: daysAgo(5),
      priority: Priority.CRITICAL,
      assignedToId: otherMember.id,
    },
  });

  otherCtx = {
    userId: otherUser.id,
    userEmail: otherUser.email,
    userName: otherUser.name,
    organizationId: otherOrg.id,
    organizationSlug: otherOrg.slug,
    membershipId: otherMember.id,
    role: OrgRole.OWNER,
  };
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

function rowFor<T extends { memberId: string }>(
  rows: readonly T[],
  id: string | undefined,
): T {
  const row = rows.find((r) => r.memberId === id);
  if (!row) throw new Error(`No team row for member ${id}`);
  return row;
}

suite("Team Dashboard", () => {
  it("returns one row per member", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    expect(rows).toHaveLength(4);
  });

  it("credits each task to exactly one member despite the shared name", async () => {
    // Audit D4: under the legacy name rule both John Smiths would claim all
    // six of their combined tasks.
    const rows = await getTeamDashboard(ctx, TODAY);
    const a = rowFor(rows, members.twinA);
    const b = rowFor(rows, members.twinB);

    expect(a.memberName).toBe(b.memberName);
    expect(a.assigned).toBe(3);
    // twinB's third task is cancelled, so 2 counted.
    expect(b.assigned).toBe(2);

    const assignedTotal = rows.reduce((sum, r) => sum + r.assigned, 0);
    const realAssigned = await prisma.task.count({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        assignedToId: { not: null },
        status: { not: TaskStatus.CANCELLED },
      },
    });
    expect(assignedTotal).toBe(realAssigned);
  });

  it("counts each column by the legacy rules", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    const a = rowFor(rows, members.twinA);

    expect(a.completed).toBe(1);
    expect(a.inProgress).toBe(1);
    expect(a.overdue).toBe(1);
    expect(a.waitingClient).toBe(0);
    // Critical counts OPEN tasks only.
    expect(a.critical).toBe(1);
    expect(a.completionPct).toBeCloseTo(1 / 3, 10);

    const b = rowFor(rows, members.twinB);
    expect(b.waitingClient).toBe(1);
    expect(b.overdue).toBe(1);
    expect(b.completed).toBe(0);
  });

  it("excludes cancelled and soft-deleted tasks", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    const a = rowFor(rows, members.twinA);
    // The soft-deleted Critical blocked task would raise assigned, overdue and
    // critical if it leaked.
    expect(a.assigned).toBe(3);
    expect(a.critical).toBe(1);

    const b = rowFor(rows, members.twinB);
    expect(b.assigned).toBe(2);
  });

  it("leaves unassigned work out of every row", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    const total = rows.reduce((sum, r) => sum + r.assigned, 0);
    const allNonCancelled = await prisma.task.count({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: { not: TaskStatus.CANCELLED },
      },
    });
    // One task is unassigned, so the team total is one short of the whole.
    expect(total).toBe(allNonCancelled - 1);
  });

  it("judges overload per person against their own capacity", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    // twinA has 2 open against capacity 2 — at the limit, not over.
    expect(rowFor(rows, members.twinA).overloaded).toBe(false);
    // twinB has 2 open against capacity 2 — also not over.
    expect(rowFor(rows, members.twinB).overloaded).toBe(false);
  });

  it("never flags a member whose capacity is unset", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    const n = rowFor(rows, members.unrated);
    expect(n.capacity).toBeNull();
    // Three open tasks and still not overloaded — legacy refuses to guess a
    // ceiling for someone the firm never rated.
    expect(n.overloaded).toBe(false);
  });

  it("honours the organization's overload margin", async () => {
    // twinA carries 2 open tasks; drop their capacity to 1 so they are over.
    await prisma.organizationMember.update({
      where: { id: members.twinA },
      data: { capacity: 1 },
    });
    const tight = await getTeamDashboard(ctx, TODAY);
    expect(rowFor(tight, members.twinA).overloaded).toBe(true);

    await prisma.organizationSetting.updateMany({
      where: {
        organizationId: ctx.organizationId,
        key: "WORKLOAD_OVERLOAD_MARGIN",
      },
      data: { value: "1" },
    });
    const lenient = await getTeamDashboard(ctx, TODAY);
    // 2 open against capacity 1 + margin 1 is no longer over.
    expect(rowFor(lenient, members.twinA).overloaded).toBe(false);

    await prisma.organizationSetting.updateMany({
      where: {
        organizationId: ctx.organizationId,
        key: "WORKLOAD_OVERLOAD_MARGIN",
      },
      data: { value: "0" },
    });
    await prisma.organizationMember.update({
      where: { id: members.twinA },
      data: { capacity: 2 },
    });
  });

  it("never counts another organization's tasks", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    expect(rows.some((r) => r.memberName === "Neighbour Owner")).toBe(false);

    const neighbour = await getTeamDashboard(otherCtx, TODAY);
    expect(neighbour).toHaveLength(1);
    expect(neighbour[0]?.assigned).toBe(1);
  });
});

suite("Management Report — client performance", () => {
  it("groups by health and orders On Track by weighted completion", async () => {
    const report = await getManagementReport(ctx, TODAY);
    expect(report.clientPerformance.best).toEqual(["TM best", "TM good"]);
    expect(report.clientPerformance.atRisk).toEqual(["TM risky"]);
    expect(report.clientPerformance.delayed).toEqual(["TM late"]);
    expect(report.clientPerformance.onHold).toEqual(["TM paused"]);
  });

  it("places every client in exactly one group", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const { best, atRisk, delayed, onHold } = report.clientPerformance;
    const all = [...best, ...atRisk, ...delayed, ...onHold];
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
  });
});

suite("Management Report — team performance", () => {
  it("reports per member, excluding cancelled work", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const rows = report.teamPerformance;
    expect(rows).toHaveLength(4);

    // Both John Smiths appear as separate rows with their own totals.
    const smiths = rows.filter((r) => r.member === "John Smith");
    expect(smiths).toHaveLength(2);
    expect(smiths.map((r) => r.tasks).sort()).toEqual([2, 3]);
  });

  it("agrees with the Team Dashboard on assigned counts", async () => {
    const [report, team] = await Promise.all([
      getManagementReport(ctx, TODAY),
      getTeamDashboard(ctx, TODAY),
    ]);
    // Both sections describe the same population; a disagreement would mean
    // one of them is matching assignments differently.
    const reportTotal = report.teamPerformance.reduce((s, r) => s + r.tasks, 0);
    const teamTotal = team.reduce((s, r) => s + r.assigned, 0);
    expect(reportTotal).toBe(teamTotal);
  });
});

suite("Management Report — operational risks", () => {
  it("counts by the legacy scopes", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const risks = report.operationalRisks;

    // Overdue runs across ALL tasks: twinA -3, twinB -1, unassigned -6.
    expect(risks.overdueTasks).toBe(3);
    // Critical issues: open only — the resolved one does not count.
    expect(risks.criticalIssues).toBe(2);
    // Blocked runs across all tasks: twinB's and the unassigned one.
    expect(risks.blockedTasks).toBe(2);
    // Outstanding requests: open only.
    expect(risks.outstandingRequests).toBe(3);
  });

  it("excludes soft-deleted records from every risk count", async () => {
    const deleted = await prisma.task.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { status: true, dueDate: true },
    });
    // The deleted task is Blocked and overdue, so it would move two counts.
    expect(deleted.status).toBe(TaskStatus.BLOCKED);

    const report = await getManagementReport(ctx, TODAY);
    expect(report.operationalRisks.blockedTasks).toBe(2);
    expect(report.operationalRisks.overdueTasks).toBe(3);
  });
});

suite("Management Report — management attention", () => {
  it("orders by category, not by severity across categories", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const types = report.managementAttention.map((i) => i.type);

    // Delayed clients → Critical issues → Blocked tasks → Stale requests.
    const order = [
      "Client Delayed",
      "Critical Issue",
      "Blocked Task",
      "Stale Request",
    ];
    const positions = types.map((t) => order.indexOf(t));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]! >= positions[i - 1]!).toBe(true);
    }
  });

  it("includes each category from the fixture", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const types = new Set(report.managementAttention.map((i) => i.type));
    expect(types).toEqual(
      new Set([
        "Client Delayed",
        "Critical Issue",
        "Blocked Task",
        "Stale Request",
      ]),
    );
  });

  it("names the client alongside the item", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const issue = report.managementAttention.find(
      (i) => i.type === "Critical Issue",
    );
    expect(issue?.label).toMatch(/\(TM (late|risky)\)$/);
  });

  it("counts stale requests by the organization's threshold", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const stale = report.managementAttention.filter(
      (i) => i.type === "Stale Request",
    );
    // Two open requests are 20 and 16 days old; the third is 3 days old.
    expect(stale).toHaveLength(2);
  });

  it("caps the list at the legacy limit", async () => {
    expect(MANAGEMENT_ATTENTION_LIMIT).toBe(15);

    // Push well past the cap with blocked tasks.
    const created: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t = await prisma.task.create({
        data: {
          organizationId: ctx.organizationId,
          displayId: formatDisplayId("TASK", 800 + i),
          clientId: clients.good!,
          taskName: `TM overflow ${i}`,
          serviceArea: "Tax",
          status: TaskStatus.BLOCKED,
          priority: Priority.MEDIUM,
        },
        select: { id: true },
      });
      created.push(t.id);
    }

    const report = await getManagementReport(ctx, TODAY);
    expect(report.managementAttention).toHaveLength(MANAGEMENT_ATTENTION_LIMIT);
    // The cap truncates from the tail, so the highest-priority categories
    // survive and stale requests fall off.
    const types = new Set(report.managementAttention.map((i) => i.type));
    expect(types.has("Client Delayed")).toBe(true);
    expect(types.has("Stale Request")).toBe(false);

    await prisma.task.deleteMany({ where: { id: { in: created } } });
  });
});

suite("Management Report — tenancy", () => {
  it("reports only the caller's organization", async () => {
    const report = await getManagementReport(ctx, TODAY);
    const names = [
      ...report.clientPerformance.best,
      ...report.clientPerformance.atRisk,
      ...report.clientPerformance.delayed,
      ...report.clientPerformance.onHold,
    ];
    expect(names).not.toContain("Neighbour client");
    expect(
      report.teamPerformance.some((r) => r.member === "Neighbour Owner"),
    ).toBe(false);
    expect(
      report.managementAttention.some((i) => i.label.includes("Neighbour")),
    ).toBe(false);
  });

  it("gives the neighbour its own separate figures", async () => {
    const report = await getManagementReport(otherCtx, TODAY);
    expect(report.clientPerformance.delayed).toEqual(["Neighbour client"]);
    expect(report.operationalRisks.blockedTasks).toBe(1);
    expect(report.teamPerformance).toHaveLength(1);
  });
});
