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
import { computeSimpleCompletion } from "@/lib/domain/progress";
import { formatDisplayId } from "@/lib/domain/ids";
import type { OrgContext } from "@/server/context";
import {
  UPCOMING_DEADLINES_LIMIT,
  getClientDashboard,
  getClientPickerOptions,
} from "@/server/services/client-dashboard";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 8 integration tests — the Client Dashboard against PostgreSQL.
 *
 * Legacy's engine renders seven sections with different scopes, and getting
 * one wrong is invisible on screen: the summary cards and service progress
 * see EVERY task, while the three tables below show OPEN items only. Each
 * scope is pinned separately here.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-cd";
const OTHER_SLUG = "test-org-cd-other";
const EMAIL_DOMAIN = "@cd-test.example.com";

const TODAY = new Date(2026, 7, 15);
const daysAgo = (n: number) => new Date(2026, 7, 15 - n);
const daysAhead = (n: number) => new Date(2026, 7, 15 + n);

let ctx: OrgContext;
let otherCtx: OrgContext;
let clientId: string;
let quietClientId: string;
let otherClientId: string;

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

async function buildOrg(slug: string, name: string, prefix: string) {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: `${prefix} Owner`,
      email: `${prefix}-owner${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true, name: true, email: true },
  });
  const member = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", 1),
      role: OrgRole.OWNER,
      isActive: true,
    },
    select: { id: true },
  });
  const pkg = await prisma.servicePackage.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });

  const context: OrgContext = {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
    role: OrgRole.OWNER,
  };

  return { org, member, pkg, context };
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const main = await buildOrg(SLUG, "CD Test Org", "primary");
  ctx = main.context;

  const makeClient = async (
    seq: number,
    clientName: string,
    extra: Record<string, unknown> = {},
  ) => {
    const created = await prisma.client.create({
      data: {
        organizationId: main.org.id,
        displayId: formatDisplayId("CLIENT", seq),
        name: clientName,
        servicePackageId: main.pkg.id,
        accountManagerId: main.member.id,
        startDate: new Date(2026, 0, 1),
        contractStatus: ContractStatus.ACTIVE,
        health: ClientHealth.AT_RISK,
        simpleCompletionPct: 0.45,
        weightedCompletionPct: 0.38,
        nextDeadline: daysAhead(3),
        priority: Priority.HIGH,
        ...extra,
      },
      select: { id: true },
    });
    return created.id;
  };

  // "Alpha" sorts before "Zephyr", so the picker's first entry is
  // deterministic for the default-selection test.
  clientId = await makeClient(1, "Alpha Engagement");
  quietClientId = await makeClient(2, "Zephyr Quiet", {
    health: ClientHealth.ON_TRACK,
    simpleCompletionPct: 0,
    weightedCompletionPct: 0,
    nextDeadline: null,
  });

  /**
   * Tasks for the main client, chosen so each of the seven cards is distinct
   * and the two scopes (all tasks vs open only) cannot be confused.
   */
  const taskSpec: {
    status: TaskStatus;
    dueDate: Date | null;
    area: string;
  }[] = [
    { status: TaskStatus.COMPLETED, dueDate: daysAgo(20), area: "Bookkeeping" },
    { status: TaskStatus.COMPLETED, dueDate: daysAgo(10), area: "Bookkeeping" },
    { status: TaskStatus.IN_PROGRESS, dueDate: daysAgo(4), area: "Bookkeeping" },
    { status: TaskStatus.IN_PROGRESS, dueDate: daysAhead(6), area: "Tax" },
    { status: TaskStatus.NOT_STARTED, dueDate: daysAhead(9), area: "Tax" },
    { status: TaskStatus.WAITING_CLIENT, dueDate: daysAgo(2), area: "Payroll" },
    { status: TaskStatus.BLOCKED, dueDate: daysAhead(1), area: "Payroll" },
    // Cancelled: excluded from every card and from service progress.
    { status: TaskStatus.CANCELLED, dueDate: daysAgo(30), area: "Payroll" },
    // Open with no due date: counts in Total, sorts LAST in Current tasks,
    // and is absent from Upcoming deadlines.
    { status: TaskStatus.NOT_STARTED, dueDate: null, area: "Advisory" },
    // Blank service area: groups under "Unspecified", not dropped.
    { status: TaskStatus.IN_PROGRESS, dueDate: daysAhead(12), area: "" },
  ];

  for (const [index, entry] of taskSpec.entries()) {
    await prisma.task.create({
      data: {
        organizationId: main.org.id,
        displayId: formatDisplayId("TASK", index + 1),
        clientId,
        taskName: `CD task ${index + 1}`,
        serviceArea: entry.area,
        status: entry.status,
        dueDate: entry.dueDate,
        priority: Priority.MEDIUM,
        assignedToId: main.member.id,
      },
    });
  }

  // Soft-deleted: must not reach any section.
  await prisma.task.create({
    data: {
      organizationId: main.org.id,
      displayId: formatDisplayId("TASK", 99),
      clientId,
      taskName: "CD deleted task",
      serviceArea: "Bookkeeping",
      status: TaskStatus.BLOCKED,
      dueDate: daysAgo(1),
      priority: Priority.MEDIUM,
      deletedAt: new Date(),
    },
  });

  const requestSpec: { status: RequestStatus; requested: Date }[] = [
    { status: RequestStatus.REQUESTED, requested: daysAgo(18) },
    { status: RequestStatus.PARTIALLY_RECEIVED, requested: daysAgo(6) },
    { status: RequestStatus.RECEIVED, requested: daysAgo(25) },
    { status: RequestStatus.CANCELLED, requested: daysAgo(9) },
  ];
  for (const [index, entry] of requestSpec.entries()) {
    await prisma.clientRequest.create({
      data: {
        organizationId: main.org.id,
        displayId: formatDisplayId("CLIENT_REQUEST", index + 1),
        clientId,
        title: `CD request ${index + 1}`,
        status: entry.status,
        requestedDate: entry.requested,
        receivedDate:
          entry.status === RequestStatus.RECEIVED ? daysAgo(3) : null,
        priority: Priority.MEDIUM,
      },
    });
  }

  const issueSpec: { severity: IssueSeverity; status: IssueStatus }[] = [
    { severity: IssueSeverity.MEDIUM, status: IssueStatus.OPEN },
    { severity: IssueSeverity.CRITICAL, status: IssueStatus.IN_PROGRESS },
    { severity: IssueSeverity.HIGH, status: IssueStatus.OPEN },
    { severity: IssueSeverity.CRITICAL, status: IssueStatus.RESOLVED },
  ];
  for (const [index, entry] of issueSpec.entries()) {
    await prisma.issue.create({
      data: {
        organizationId: main.org.id,
        displayId: formatDisplayId("ISSUE", index + 1),
        clientId,
        title: `CD issue ${index + 1}`,
        severity: entry.severity,
        status: entry.status,
        dateRaised: daysAgo(10 - index),
      },
    });
  }

  const other = await buildOrg(OTHER_SLUG, "CD Other Org", "secondary");
  otherCtx = other.context;
  const otherClient = await prisma.client.create({
    data: {
      organizationId: other.org.id,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Neighbour client",
      servicePackageId: other.pkg.id,
      accountManagerId: other.member.id,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      priority: Priority.MEDIUM,
    },
    select: { id: true },
  });
  otherClientId = otherClient.id;

  await prisma.task.create({
    data: {
      organizationId: other.org.id,
      displayId: formatDisplayId("TASK", 1),
      clientId: otherClientId,
      taskName: "Neighbour task",
      serviceArea: "Tax",
      status: TaskStatus.BLOCKED,
      dueDate: daysAgo(3),
      priority: Priority.MEDIUM,
    },
  });
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("getClientPickerOptions", () => {
  it("lists this organization's clients alphabetically", async () => {
    const options = await getClientPickerOptions(ctx);
    expect(options.map((c) => c.name)).toEqual([
      "Alpha Engagement",
      "Zephyr Quiet",
    ]);
  });

  it("never offers another organization's client", async () => {
    const options = await getClientPickerOptions(ctx);
    expect(options.some((c) => c.id === otherClientId)).toBe(false);
  });
});

suite("Client Dashboard — the seven summary cards", () => {
  it("counts every status, excluding cancelled", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // 10 tasks in the fixture, minus the cancelled one; the soft-deleted one
    // never loads.
    expect(dash.summary.total).toBe(9);
    expect(dash.summary.completed).toBe(2);
    expect(dash.summary.inProgress).toBe(3);
    expect(dash.summary.notStarted).toBe(2);
    expect(dash.summary.waitingClient).toBe(1);
    expect(dash.summary.blocked).toBe(1);
  });

  it("counts overdue by the shared date rule", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // In Progress -4 and Waiting Client -2. The completed ones are past their
    // dates but closed; the cancelled one is excluded; the undated one cannot
    // be overdue.
    expect(dash.summary.overdue).toBe(2);
  });

  it("sees ALL tasks, not just open ones", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // The cards include Completed, so their scope is wider than the Current
    // tasks table below — the distinction legacy's engine makes.
    expect(dash.summary.completed).toBeGreaterThan(0);
    expect(dash.summary.total).toBeGreaterThan(dash.currentTasks.length);
  });

  it("returns zeroes for a client with no tasks", async () => {
    const dash = (await getClientDashboard(ctx, quietClientId, TODAY))!;
    expect(dash.summary.total).toBe(0);
    expect(dash.summary.overdue).toBe(0);
    expect(dash.serviceProgress).toEqual([]);
    expect(dash.currentTasks).toEqual([]);
    expect(dash.upcomingDeadlines).toEqual([]);
  });
});

suite("Client Dashboard — service area progress", () => {
  it("groups alphabetically and excludes cancelled tasks", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // Payroll keeps its cancelled task out; "" becomes Unspecified.
    expect(dash.serviceProgress.map((r) => r.serviceArea)).toEqual([
      "Advisory",
      "Bookkeeping",
      "Payroll",
      "Tax",
      "Unspecified",
    ]);
  });

  it("uses simple completion per area", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    const bookkeeping = dash.serviceProgress.find(
      (r) => r.serviceArea === "Bookkeeping",
    );
    // 2 completed of 3 non-cancelled.
    expect(bookkeeping?.completionPct).toBeCloseTo(2 / 3, 10);

    const tax = dash.serviceProgress.find((r) => r.serviceArea === "Tax");
    expect(tax?.completionPct).toBe(0);
  });

  it("agrees with computeSimpleCompletion on every area", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    const tasks = await prisma.task.findMany({
      where: { clientId, deletedAt: null },
      select: { serviceArea: true, status: true },
    });

    for (const row of dash.serviceProgress) {
      const inArea = tasks.filter(
        (t) =>
          (t.serviceArea || "Unspecified") === row.serviceArea &&
          t.status !== TaskStatus.CANCELLED,
      );
      expect(
        computeSimpleCompletion(inArea as never).pct,
        row.serviceArea,
      ).toBeCloseTo(row.completionPct, 10);
    }
  });

  it("keeps an unspecified area rather than dropping those tasks", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.serviceProgress.some((r) => r.serviceArea === "Unspecified")).toBe(
      true,
    );
  });
});

suite("Client Dashboard — current tasks", () => {
  it("shows open tasks only", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // 9 non-cancelled minus 2 completed = 7 open.
    expect(dash.currentTasks).toHaveLength(7);
    expect(
      dash.currentTasks.every(
        (t) =>
          t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      ),
    ).toBe(true);
  });

  it("sorts soonest due first with undated tasks LAST", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    const dates = dash.currentTasks.map((t) => t.dueDate);

    // Legacy has two implementations that disagree here: the sheet engine's
    // `new Date(due || 0)` puts undated tasks FIRST, while the Web App's
    // taskDueDateSortKey puts them LAST and its own comment argues a missing
    // date is not "most urgent". The Web App rule is the one migrated.
    expect(dates[dates.length - 1]).toBeNull();

    const dated = dates.filter((d): d is Date => d !== null);
    for (let i = 1; i < dated.length; i += 1) {
      expect(dated[i]!.getTime() >= dated[i - 1]!.getTime()).toBe(true);
    }
    expect(dates.slice(0, dated.length).every((d) => d !== null)).toBe(true);
  });

  it("carries days remaining, negative once overdue", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    const overdue = dash.currentTasks.filter(
      (t) => t.daysRemaining !== null && t.daysRemaining < 0,
    );
    expect(overdue).toHaveLength(2);
    // The undated task has no days remaining rather than a zero.
    const undated = dash.currentTasks.find((t) => t.dueDate === null);
    expect(undated?.daysRemaining).toBeNull();
  });

  it("omits soft-deleted tasks", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(
      dash.currentTasks.some((t) => t.taskName === "CD deleted task"),
    ).toBe(false);
    expect(dash.summary.blocked).toBe(1);
  });
});

suite("Client Dashboard — requests and issues", () => {
  it("shows open requests only, longest waiting first", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.requests).toHaveLength(2);
    expect(
      dash.requests.every(
        (r) =>
          r.status === RequestStatus.REQUESTED ||
          r.status === RequestStatus.PARTIALLY_RECEIVED,
      ),
    ).toBe(true);
    expect(dash.requests[0]?.daysWaiting).toBe(18);
    expect(dash.requests[1]?.daysWaiting).toBe(6);
  });

  it("derives the days-waiting bucket", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.requests[0]?.daysWaitingBucket).toBe("15+");
    expect(dash.requests[1]?.daysWaitingBucket).toBe("4-7");
  });

  it("shows open issues only, most severe first", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.issues).toHaveLength(3);
    expect(dash.issues.map((i) => i.severity)).toEqual([
      IssueSeverity.CRITICAL,
      IssueSeverity.HIGH,
      IssueSeverity.MEDIUM,
    ]);
    // The resolved Critical is excluded despite outranking everything.
    expect(
      dash.issues.every((i) => i.status !== IssueStatus.RESOLVED),
    ).toBe(true);
  });
});

suite("Client Dashboard — upcoming deadlines", () => {
  it("lists open tasks that have a due date, soonest first", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // 7 open, minus the undated one.
    expect(dash.upcomingDeadlines).toHaveLength(6);
    expect(dash.upcomingDeadlines.every((d) => d.dueDate !== null)).toBe(true);

    const times = dash.upcomingDeadlines.map((d) => d.dueDate.getTime());
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! >= times[i - 1]!).toBe(true);
    }
  });

  it("includes tasks already past due, as legacy did", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    // Legacy filtered on "open AND has a due date" — not on the date being in
    // the future — so overdue work stays visible here.
    expect(
      dash.upcomingDeadlines.some(
        (d) => d.daysRemaining !== null && d.daysRemaining < 0,
      ),
    ).toBe(true);
  });

  it("caps the list at the legacy limit", async () => {
    expect(UPCOMING_DEADLINES_LIMIT).toBe(10);
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.upcomingDeadlines.length).toBeLessThanOrEqual(
      UPCOMING_DEADLINES_LIMIT,
    );
  });
});

suite("Client Dashboard — client info block", () => {
  it("reads the stored derived columns rather than recomputing", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.client.simpleCompletionPct).toBeCloseTo(0.45, 10);
    expect(dash.client.weightedCompletionPct).toBeCloseTo(0.38, 10);
    expect(dash.client.health).toBe(ClientHealth.AT_RISK);
    expect(dash.client.nextDeadline).not.toBeNull();
  });

  it("carries the account manager and service package names", async () => {
    const dash = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(dash.client.accountManagerName).toBe("primary Owner");
    expect(dash.client.servicePackageName).toBe("Basic Accounting");
  });
});

suite("Client Dashboard — tenancy", () => {
  it("returns null for a client in another organization", async () => {
    expect(await getClientDashboard(ctx, otherClientId, TODAY)).toBeNull();
  });

  it("returns null for an id that does not exist", async () => {
    expect(
      await getClientDashboard(ctx, "11111111-1111-4111-8111-111111111111", TODAY),
    ).toBeNull();
  });

  it("never mixes another organization's tasks into a client's sections", async () => {
    const neighbour = (await getClientDashboard(
      otherCtx,
      otherClientId,
      TODAY,
    ))!;
    expect(neighbour.summary.total).toBe(1);
    expect(
      neighbour.currentTasks.every((t) => t.taskName === "Neighbour task"),
    ).toBe(true);

    const mine = (await getClientDashboard(ctx, clientId, TODAY))!;
    expect(mine.currentTasks.some((t) => t.taskName === "Neighbour task")).toBe(
      false,
    );
  });
});
