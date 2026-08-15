import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  OrgRole,
  Priority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { KPI_LINKS } from "@/lib/dashboard/kpi-links";
import { formatDisplayId } from "@/lib/domain/ids";
import { clientListQuerySchema } from "@/lib/validation/client";
import { issueListQuerySchema } from "@/lib/validation/issue";
import { taskListQuerySchema } from "@/lib/validation/task";
import type { OrgContext } from "@/server/context";
import { listClients } from "@/server/services/clients";
import { getControlCenterViewModel } from "@/server/services/dashboard";
import { listIssues } from "@/server/services/issue-queries";
import { seedOrgSettings } from "@/server/services/settings";
import { listTasks } from "@/server/services/task-queries";

/**
 * Phase 7 integration tests — the Control Center against PostgreSQL.
 *
 * The load-bearing assertion is the last one: **every KPI's value equals the
 * total its own drill-down link returns.** A dashboard whose number disagrees
 * with the page behind it is worse than one with no links at all, and that
 * equality depends on data, so it cannot be proven by a unit test.
 *
 * The fixture is built to make each KPI non-zero and mutually distinguishable
 * — a suite where every count is 0 would pass trivially.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-cc";
const EMAIL_DOMAIN = "@cc-test.example.com";

const TODAY = new Date(2026, 7, 15);
const daysAgo = (n: number) => new Date(2026, 7, 15 - n);
const daysAhead = (n: number) => new Date(2026, 7, 15 + n);

let ctx: OrgContext;
let memberId: string;
let clientIds: Record<string, string>;

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: SLUG },
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
    data: { name: "Control Center Test Org", slug: SLUG },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: "CC Owner",
      email: `owner${EMAIL_DOMAIN}`,
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
  memberId = member.id;

  ctx = {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
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

  /**
   * Six clients spanning every contract status and health value the KPIs
   * count, so no card reads zero by accident.
   *
   * Health and completion are written directly rather than derived: this
   * suite is about how the Control Center READS those columns, and the
   * engines that WRITE them are proven in Phases 3 and 4.
   */
  const spec = [
    { key: "activeOnTrack", status: ContractStatus.ACTIVE, health: ClientHealth.ON_TRACK, pct: 0.8 },
    { key: "activeAtRisk", status: ContractStatus.ACTIVE, health: ClientHealth.AT_RISK, pct: 0.5 },
    { key: "activeDelayed", status: ContractStatus.ACTIVE, health: ClientHealth.DELAYED, pct: 0.2 },
    { key: "onboarding", status: ContractStatus.ONBOARDING, health: ClientHealth.ON_TRACK, pct: 0.1 },
    { key: "onHold", status: ContractStatus.ON_HOLD, health: ClientHealth.ON_HOLD, pct: 0.4 },
    { key: "completed", status: ContractStatus.COMPLETED, health: ClientHealth.ON_TRACK, pct: 1 },
  ];

  clientIds = {};
  for (const [index, entry] of spec.entries()) {
    const created = await prisma.client.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("CLIENT", index + 1),
        name: `CC ${entry.key}`,
        servicePackageId: pkg.id,
        accountManagerId: member.id,
        startDate: new Date(2026, 0, 1),
        contractStatus: entry.status,
        health: entry.health,
        weightedCompletionPct: entry.pct,
        priority: Priority.MEDIUM,
      },
      select: { id: true },
    });
    clientIds[entry.key] = created.id;
  }

  // An archived client: excluded from every KPI and from every drill-down.
  await prisma.client.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("CLIENT", 99),
      name: "CC archived",
      servicePackageId: pkg.id,
      accountManagerId: member.id,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      health: ClientHealth.DELAYED,
      weightedCompletionPct: 0,
      priority: Priority.MEDIUM,
      deletedAt: new Date(2026, 6, 1),
    },
  });

  /**
   * Tasks covering each counted status, plus overdue and cancelled cases.
   * Deliberately spread across an Active, an Onboarding and an On Hold client
   * — legacy's task KPIs are unscoped by contract status, and a fixture that
   * put them all on Active clients could not tell the difference.
   */
  const taskSpec: {
    client: string;
    status: TaskStatus;
    dueDate: Date | null;
  }[] = [
    { client: "activeOnTrack", status: TaskStatus.NOT_STARTED, dueDate: daysAhead(5) },
    { client: "activeAtRisk", status: TaskStatus.IN_PROGRESS, dueDate: daysAgo(3) },
    { client: "activeDelayed", status: TaskStatus.IN_PROGRESS, dueDate: daysAgo(9) },
    { client: "activeDelayed", status: TaskStatus.BLOCKED, dueDate: daysAgo(1) },
    { client: "activeAtRisk", status: TaskStatus.WAITING_CLIENT, dueDate: daysAhead(2) },
    { client: "onboarding", status: TaskStatus.WAITING_CLIENT, dueDate: daysAgo(4) },
    { client: "onHold", status: TaskStatus.BLOCKED, dueDate: daysAhead(10) },
    { client: "activeOnTrack", status: TaskStatus.COMPLETED, dueDate: daysAgo(20) },
    { client: "completed", status: TaskStatus.COMPLETED, dueDate: daysAgo(30) },
    // Cancelled is excluded from every task KPI.
    { client: "activeOnTrack", status: TaskStatus.CANCELLED, dueDate: daysAgo(2) },
    // No due date: open but never overdue.
    { client: "activeOnTrack", status: TaskStatus.IN_PROGRESS, dueDate: null },
  ];

  for (const [index, entry] of taskSpec.entries()) {
    await prisma.task.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("TASK", index + 1),
        clientId: clientIds[entry.client]!,
        taskName: `CC task ${index + 1}`,
        serviceArea: "Tax",
        status: entry.status,
        dueDate: entry.dueDate,
        priority: Priority.MEDIUM,
      },
    });
  }

  // A soft-deleted task: must not reach any KPI.
  await prisma.task.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("TASK", 99),
      clientId: clientIds.activeOnTrack!,
      taskName: "CC deleted task",
      serviceArea: "Tax",
      status: TaskStatus.BLOCKED,
      dueDate: daysAgo(5),
      priority: Priority.MEDIUM,
      deletedAt: new Date(),
    },
  });

  /** Issues covering surfaced and unsurfaced, open and closed. */
  const issueSpec: {
    client: string;
    severity: IssueSeverity;
    status: IssueStatus;
    deadline: Date | null;
  }[] = [
    // Surfaced: open + Critical.
    { client: "activeDelayed", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN, deadline: null },
    // Surfaced: open + High.
    { client: "activeAtRisk", severity: IssueSeverity.HIGH, status: IssueStatus.IN_PROGRESS, deadline: daysAhead(4) },
    // Surfaced: open + past deadline, despite Low severity.
    { client: "onboarding", severity: IssueSeverity.LOW, status: IssueStatus.OPEN, deadline: daysAgo(2) },
    // Open but not surfaced: Medium, future deadline.
    { client: "activeOnTrack", severity: IssueSeverity.MEDIUM, status: IssueStatus.OPEN, deadline: daysAhead(20) },
    // Closed at High: not open, not surfaced.
    { client: "activeOnTrack", severity: IssueSeverity.HIGH, status: IssueStatus.RESOLVED, deadline: daysAgo(10) },
    // Cancelled is a closed status too.
    { client: "onHold", severity: IssueSeverity.CRITICAL, status: IssueStatus.CANCELLED, deadline: daysAgo(5) },
  ];

  for (const [index, entry] of issueSpec.entries()) {
    await prisma.issue.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("ISSUE", index + 1),
        clientId: clientIds[entry.client]!,
        title: `CC issue ${index + 1}`,
        severity: entry.severity,
        status: entry.status,
        dateRaised: daysAgo(12 - index),
        deadline: entry.deadline,
        assignedToId: member.id,
      },
    });
  }
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

function kpiValue(kpis: { key: string; value: number }[], key: string): number {
  const kpi = kpis.find((k) => k.key === key);
  if (!kpi) throw new Error(`No KPI named ${key}`);
  return kpi.value;
}

suite("Control Center KPIs", () => {
  it("produces the fourteen legacy KPIs, in order", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.kpis.map((k) => k.key)).toEqual([
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

  it("counts the client KPIs from the fixture", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    // Six live clients; the archived one is excluded.
    expect(kpiValue(kpis, "totalClients")).toBe(6);
    expect(kpiValue(kpis, "activeClients")).toBe(3);
    expect(kpiValue(kpis, "onboardingClients")).toBe(1);
    expect(kpiValue(kpis, "onHoldClients")).toBe(1);
    expect(kpiValue(kpis, "clientsAtRisk")).toBe(1);
    expect(kpiValue(kpis, "clientsDelayed")).toBe(1);
  });

  it("counts the task KPIs across ALL clients, not just Active ones", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);

    // Open: 6 on Active clients (including the undated In Progress one),
    // 1 Onboarding, 1 On Hold = 8. Cancelled, both Completed, and the
    // soft-deleted task are all excluded.
    expect(kpiValue(kpis, "openTasks")).toBe(8);

    // Overdue: In Progress -3, In Progress -9, Blocked -1, Waiting -4. The
    // completed ones are not overdue, nor is the cancelled one, nor the
    // undated one.
    expect(kpiValue(kpis, "overdueTasks")).toBe(4);

    expect(kpiValue(kpis, "tasksCompleted")).toBe(2);
    expect(kpiValue(kpis, "waitingOnClient")).toBe(2);
    expect(kpiValue(kpis, "blockedTasks")).toBe(2);
  });

  it("excludes cancelled tasks from every task KPI", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    const cancelled = await prisma.task.count({
      where: {
        organizationId: ctx.organizationId,
        status: TaskStatus.CANCELLED,
        deletedAt: null,
      },
    });
    expect(cancelled).toBeGreaterThan(0);

    // The cancelled task is overdue by date, so it would inflate this count
    // if the exclusion were dropped.
    const overdueIncludingCancelled = await prisma.task.count({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        dueDate: { lt: TODAY },
        status: { not: TaskStatus.COMPLETED },
      },
    });
    expect(kpiValue(kpis, "overdueTasks")).toBeLessThan(
      overdueIncludingCancelled,
    );
  });

  it("counts open and surfaced issues by the ported rules", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    // Open: Critical, High-in-progress, Low-overdue, Medium-future = 4.
    expect(kpiValue(kpis, "openIssues")).toBe(4);
    // Surfaced: the Critical, the High, and the overdue Low. The Medium with
    // a future deadline is not; the Resolved High and Cancelled Critical are
    // not open.
    expect(kpiValue(kpis, "issuesNeedingAttention")).toBe(3);
  });

  it("computes Overall Completion % as a plain mean of client percentages", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    // (0.8 + 0.5 + 0.2 + 0.1 + 0.4 + 1) / 6 = 0.5 — every client counts
    // equally regardless of task volume (audit §8.2, flagged for review).
    expect(kpiValue(kpis, "overallCompletionPct")).toBeCloseTo(0.5, 10);
  });

  it("weights no client by task volume in that mean", async () => {
    // The client with the most tasks has 0.8; a task-weighted figure would
    // pull the average toward it. A plain mean does not.
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    const stored = await prisma.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { weightedCompletionPct: true },
    });
    const plainMean =
      stored.reduce((sum, c) => sum + Number(c.weightedCompletionPct), 0) /
      stored.length;
    expect(kpiValue(kpis, "overallCompletionPct")).toBeCloseTo(plainMean, 10);
  });
});

suite("Control Center health table", () => {
  it("lists Active clients only", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.clientHealth).toHaveLength(3);

    const names = vm.clientHealth.map((r) => r.clientName);
    expect(names).not.toContain("CC onboarding");
    expect(names).not.toContain("CC onHold");
    expect(names).not.toContain("CC completed");
    // Archived is excluded even though its contract status is Active.
    expect(names).not.toContain("CC archived");
  });

  it("sorts most-urgent health first, then by name", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.clientHealth.map((r) => r.health)).toEqual([
      ClientHealth.DELAYED,
      ClientHealth.AT_RISK,
      ClientHealth.ON_TRACK,
    ]);
  });

  it("counts each row's overdue, waiting, and open issues per client", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    const byName = new Map(vm.clientHealth.map((r) => [r.clientName, r]));

    const delayed = byName.get("CC activeDelayed");
    expect(delayed?.overdueTasks).toBe(2);
    expect(delayed?.openIssues).toBe(1);

    const atRisk = byName.get("CC activeAtRisk");
    expect(atRisk?.overdueTasks).toBe(1);
    expect(atRisk?.waitingOnClient).toBe(1);
  });

  it("reads completion from the stored column rather than recomputing", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    const row = vm.clientHealth.find((r) => r.clientName === "CC activeOnTrack");
    expect(row?.completionPct).toBeCloseTo(0.8, 10);
  });
});

suite("Control Center surfaced issues", () => {
  it("returns exactly the issues the KPI counts", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.surfacedIssues).toHaveLength(
      kpiValue(vm.kpis, "issuesNeedingAttention"),
    );
  });

  it("orders most severe first, then longest open", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.surfacedIssues.map((i) => i.severity)).toEqual([
      IssueSeverity.CRITICAL,
      IssueSeverity.HIGH,
      IssueSeverity.LOW,
    ]);
  });

  it("reports days open from the date raised", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    for (const issue of vm.surfacedIssues) {
      expect(issue.daysOpen).not.toBeNull();
      expect(issue.daysOpen!).toBeGreaterThan(0);
    }
  });
});

suite("Control Center tenancy", () => {
  it("counts nothing from another organization", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "CC Neighbour", slug: `${SLUG}-neighbour` },
      select: { id: true },
    });
    await seedOrgSettings(otherOrg.id);
    const otherUser = await prisma.user.create({
      data: {
        name: "Neighbour",
        email: `neighbour${EMAIL_DOMAIN}`,
        passwordHash: "unused",
      },
      select: { id: true },
    });
    const otherMember = await prisma.organizationMember.create({
      data: {
        organizationId: otherOrg.id,
        userId: otherUser.id,
        displayId: formatDisplayId("MEMBER", 1),
        role: OrgRole.OWNER,
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
    await prisma.client.create({
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
    });

    const before = await getControlCenterViewModel(ctx, TODAY);
    expect(kpiValue(before.kpis, "totalClients")).toBe(6);
    expect(
      before.clientHealth.some((r) => r.clientName === "Neighbour client"),
    ).toBe(false);

    await prisma.organization.delete({ where: { id: otherOrg.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});

// ---------------------------------------------------------------------------
// The property that makes the drill-downs trustworthy
// ---------------------------------------------------------------------------

suite("KPI drill-downs agree with their destination lists", () => {
  it("returns exactly the KPI's count at every link target", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);

    for (const [key, link] of Object.entries(KPI_LINKS)) {
      const expected = kpiValue(kpis, key);

      const actual =
        link.pathname === "/clients"
          ? (await listClients(ctx, clientListQuerySchema.parse(link.query)))
              .total
          : link.pathname === "/tasks"
            ? (
                await listTasks(
                  ctx,
                  taskListQuerySchema.parse(link.query),
                  TODAY,
                )
              ).total
            : (
                await listIssues(
                  ctx,
                  issueListQuerySchema.parse(link.query),
                  TODAY,
                )
              ).total;

      expect(
        actual,
        `${key}: KPI says ${expected}, ${link.pathname} ${JSON.stringify(link.query)} returns ${actual}`,
      ).toBe(expected);
    }
  });

  it("covers a non-zero count for every KPI, so the check is not vacuous", async () => {
    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    for (const key of Object.keys(KPI_LINKS)) {
      expect(kpiValue(kpis, key), `${key} is zero in the fixture`).toBeGreaterThan(
        0,
      );
    }
  });

  it("still agrees after the data changes underneath it", async () => {
    // Resolving a surfaced issue must move the KPI and its destination
    // together, not one of them.
    const surfaced = await prisma.issue.findFirstOrThrow({
      where: {
        organizationId: ctx.organizationId,
        severity: IssueSeverity.CRITICAL,
        status: IssueStatus.OPEN,
      },
      select: { id: true },
    });
    await prisma.issue.update({
      where: { id: surfaced.id },
      data: { status: IssueStatus.RESOLVED, resolutionDate: TODAY },
    });

    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    const link = KPI_LINKS.issuesNeedingAttention!;
    const list = await listIssues(
      ctx,
      issueListQuerySchema.parse(link.query),
      TODAY,
    );

    expect(kpiValue(kpis, "issuesNeedingAttention")).toBe(2);
    expect(list.total).toBe(2);

    // Restore, so the ordering assertions above stay valid if re-run.
    await prisma.issue.update({
      where: { id: surfaced.id },
      data: { status: IssueStatus.OPEN, resolutionDate: null },
    });
  });
});

suite("Control Center excludes soft-deleted records", () => {
  it("ignores a deleted task that would otherwise be counted", async () => {
    const deleted = await prisma.task.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { id: true, status: true },
    });
    expect(deleted.status).toBe(TaskStatus.BLOCKED);

    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    // Two live blocked tasks; the deleted third is not counted.
    expect(kpiValue(kpis, "blockedTasks")).toBe(2);
  });

  it("ignores an archived client in the totals and the health table", async () => {
    const archived = await prisma.client.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { contractStatus: true, health: true },
    });
    // The fixture's archived client is Active and Delayed, so it would move
    // three separate KPIs if the exclusion were dropped.
    expect(archived.contractStatus).toBe(ContractStatus.ACTIVE);
    expect(archived.health).toBe(ClientHealth.DELAYED);

    const { kpis } = await getControlCenterViewModel(ctx, TODAY);
    expect(kpiValue(kpis, "totalClients")).toBe(6);
    expect(kpiValue(kpis, "activeClients")).toBe(3);
    expect(kpiValue(kpis, "clientsDelayed")).toBe(1);
  });
});

suite("fixture sanity", () => {
  it("uses the member and clients it created", () => {
    expect(memberId).toBeTruthy();
    expect(Object.keys(clientIds)).toHaveLength(6);
  });
});
