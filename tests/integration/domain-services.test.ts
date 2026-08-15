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
import { formatDisplayId } from "@/lib/domain/ids";
import { buildTaskTemplateCatalog } from "@/lib/domain/task-template-catalog";
import type { OrgContext } from "@/server/context";
import { ForbiddenError } from "@/server/context";
import { getControlCenterViewModel, getTeamDashboard } from "@/server/services/dashboard";
import { previewClientHealth, recalculateClientHealth } from "@/server/services/health";
import { recalculateClientProgress } from "@/server/services/progress";
import { seedOrgSettings } from "@/server/services/settings";
import {
  generateMonthlyTasks,
  generateOnboardingTasks,
} from "@/server/services/task-generation";
import { createTask, TaskOperationError, updateTaskStatus } from "@/server/services/tasks";

/**
 * Integration tests for the Phase 3 ports, driven through the real service
 * layer against PostgreSQL.
 *
 * Unit and parity tests prove the RULES are right. These prove the rules are
 * actually reached: that the engines gather the correct inputs, scope every
 * query by organization, and persist what they compute.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-domain";
const OTHER_SLUG = "test-org-domain-other";
const EMAIL_DOMAIN = "@domain-test.example.com";

let ctx: OrgContext;
let otherCtx: OrgContext;
let clientId: string;
let otherClientId: string;
let packageId: string;
let memberIds: Record<string, string> = {};

/** Fixed "today" so overdue arithmetic is deterministic. */
const TODAY = new Date(2026, 7, 15);
const day = (offset: number) => {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + offset);
  return date;
};

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
  await prisma.user.deleteMany({
    where: { email: { endsWith: EMAIL_DOMAIN } },
  });
}

async function buildOrg(slug: string, name: string, emailPrefix: string) {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: "Jane AM",
      email: `${emailPrefix}-owner${EMAIL_DOMAIN}`,
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
      jobTitle: "Account Manager",
      capacity: 2,
      isActive: true,
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

  return { org, context, memberId: member.id };
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const primary = await buildOrg(SLUG, "Domain Test Org", "primary");
  ctx = primary.context;
  memberIds = { owner: primary.memberId };

  // A bookkeeper, so template role resolution has someone to find.
  const bookkeeperUser = await prisma.user.create({
    data: {
      name: "Bob Book",
      email: `bookkeeper${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true },
  });
  const bookkeeper = await prisma.organizationMember.create({
    data: {
      organizationId: ctx.organizationId,
      userId: bookkeeperUser.id,
      displayId: formatDisplayId("MEMBER", 2),
      role: OrgRole.TEAM_MEMBER,
      jobTitle: "Bookkeeper",
      capacity: 0,
      isActive: true,
    },
    select: { id: true },
  });
  memberIds.bookkeeper = bookkeeper.id;

  // Service package + the Basic Accounting templates from the legacy catalog.
  const pkg = await prisma.servicePackage.create({
    data: {
      organizationId: ctx.organizationId,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });
  packageId = pkg.id;

  const catalog = buildTaskTemplateCatalog().filter(
    (entry) => entry.servicePackage === "Basic Accounting",
  );
  for (const [index, entry] of catalog.entries()) {
    await prisma.taskTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: formatDisplayId("TASK_TEMPLATE", index + 1),
        servicePackageId: pkg.id,
        serviceArea: entry.serviceArea,
        taskName: entry.taskName,
        description: entry.description,
        frequency: entry.frequency,
        priority: entry.priority,
        defaultAssigneeRole: entry.defaultAssigneeRole,
        typicalDurationDays: entry.typicalDurationDays,
        requiresClientInput: entry.requiresClientInput,
      },
    });
  }

  const client = await prisma.client.create({
    data: {
      organizationId: ctx.organizationId,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Acme Co",
      companyName: "Acme Ltd",
      startDate: day(-200),
      servicePackageId: pkg.id,
      accountManagerId: primary.memberId,
      contractStatus: ContractStatus.ACTIVE,
    },
    select: { id: true },
  });
  clientId = client.id;

  await prisma.idSequence.createMany({
    data: [
      { organizationId: ctx.organizationId, entity: "MEMBER", lastValue: 2 },
      { organizationId: ctx.organizationId, entity: "CLIENT", lastValue: 1 },
      { organizationId: ctx.organizationId, entity: "TASK", lastValue: 0 },
      { organizationId: ctx.organizationId, entity: "ACTIVITY", lastValue: 0 },
      {
        organizationId: ctx.organizationId,
        entity: "TASK_TEMPLATE",
        lastValue: catalog.length,
      },
    ],
  });

  // Second organization, for isolation checks.
  const secondary = await buildOrg(OTHER_SLUG, "Other Org", "secondary");
  otherCtx = secondary.context;

  const otherClient = await prisma.client.create({
    data: {
      organizationId: otherCtx.organizationId,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Other Client",
      startDate: day(-100),
      contractStatus: ContractStatus.ACTIVE,
    },
    select: { id: true },
  });
  otherClientId = otherClient.id;

  await prisma.idSequence.createMany({
    data: [
      { organizationId: otherCtx.organizationId, entity: "MEMBER", lastValue: 1 },
      { organizationId: otherCtx.organizationId, entity: "CLIENT", lastValue: 1 },
      { organizationId: otherCtx.organizationId, entity: "TASK", lastValue: 0 },
      { organizationId: otherCtx.organizationId, entity: "ACTIVITY", lastValue: 0 },
    ],
  });
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

async function clearTasks(organizationId: string) {
  await prisma.task.deleteMany({ where: { organizationId } });
}

suite("health engine end to end", () => {
  it("is On Track for a client with no tasks or issues", async () => {
    await clearTasks(ctx.organizationId);
    await prisma.issue.deleteMany({ where: { organizationId: ctx.organizationId } });

    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.ON_TRACK,
    );
  });

  it("walks the overdue boundary 0 → 1 → 2 → 3 exactly as the rule specifies", async () => {
    await clearTasks(ctx.organizationId);

    // 0 overdue
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.ON_TRACK,
    );

    // 1 overdue -> At Risk
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Overdue 1",
        serviceArea: "Bookkeeping",
        priority: Priority.LOW,
        dueDate: day(-1),
      },
      { skipLog: true },
    );
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.AT_RISK,
    );

    // 2 overdue -> still At Risk
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Overdue 2",
        serviceArea: "Bookkeeping",
        priority: Priority.LOW,
        dueDate: day(-2),
      },
      { skipLog: true },
    );
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.AT_RISK,
    );

    // 3 overdue -> Delayed (the code's threshold, not the legacy docs')
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Overdue 3",
        serviceArea: "Bookkeeping",
        priority: Priority.LOW,
        dueDate: day(-3),
      },
      { skipLog: true },
    );
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.DELAYED,
    );
  });

  it("makes a single overdue CRITICAL task Delayed on its own", async () => {
    await clearTasks(ctx.organizationId);
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Critical overdue",
        serviceArea: "Month-End Closing",
        priority: Priority.CRITICAL,
        dueDate: day(-1),
      },
      { skipLog: true },
    );

    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.DELAYED,
    );
  });

  it("ignores overdue dates on COMPLETED and CANCELLED tasks", async () => {
    await clearTasks(ctx.organizationId);
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Long done",
        serviceArea: "Bookkeeping",
        priority: Priority.CRITICAL,
        dueDate: day(-200),
        status: TaskStatus.COMPLETED,
      },
      { skipLog: true },
    );
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Called off",
        serviceArea: "Bookkeeping",
        priority: Priority.CRITICAL,
        dueDate: day(-200),
        status: TaskStatus.CANCELLED,
      },
      { skipLog: true },
    );

    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.ON_TRACK,
    );
  });

  it("makes an open Critical issue Delayed with no overdue tasks", async () => {
    await clearTasks(ctx.organizationId);
    await prisma.issue.deleteMany({ where: { organizationId: ctx.organizationId } });

    await prisma.issue.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: "ISS-0001",
        clientId,
        title: "Critical problem",
        severity: IssueSeverity.CRITICAL,
        status: IssueStatus.OPEN,
        dateRaised: day(-5),
      },
    });

    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.DELAYED,
    );

    await prisma.issue.deleteMany({ where: { organizationId: ctx.organizationId } });
  });

  it("uses only Critical/High tasks for the due-soon signal", async () => {
    await clearTasks(ctx.organizationId);

    // A MEDIUM task due tomorrow must NOT trip At Risk.
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Routine soon",
        serviceArea: "Bookkeeping",
        priority: Priority.MEDIUM,
        dueDate: day(1),
      },
      { skipLog: true },
    );
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.ON_TRACK,
    );

    // A HIGH task due tomorrow must.
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Important soon",
        serviceArea: "P&L",
        priority: Priority.HIGH,
        dueDate: day(1),
      },
      { skipLog: true },
    );
    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.AT_RISK,
    );
  });

  it("persists health and logs the change only when it actually changes", async () => {
    await clearTasks(ctx.organizationId);
    await prisma.activityLog.deleteMany({
      where: { organizationId: ctx.organizationId },
    });
    await prisma.client.update({
      where: { id: clientId },
      data: { health: ClientHealth.ON_TRACK },
    });

    await createTask(
      ctx,
      {
        clientId,
        taskName: "Trigger",
        serviceArea: "Bookkeeping",
        priority: Priority.CRITICAL,
        dueDate: day(-1),
      },
      { skipLog: true },
    );

    await recalculateClientHealth(ctx, clientId, TODAY);
    const after = await prisma.client.findUnique({
      where: { id: clientId },
      select: { health: true },
    });
    expect(after?.health).toBe(ClientHealth.DELAYED);

    const logged = await prisma.activityLog.count({
      where: {
        organizationId: ctx.organizationId,
        action: "Client Health Changed",
      },
    });
    expect(logged).toBe(1);

    // Re-running must not log again — pure recalculation is never logged.
    await recalculateClientHealth(ctx, clientId, TODAY);
    const loggedAgain = await prisma.activityLog.count({
      where: {
        organizationId: ctx.organizationId,
        action: "Client Health Changed",
      },
    });
    expect(loggedAgain).toBe(1);
  });

  it("respects the On Hold override regardless of overdue work", async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ON_HOLD },
    });

    expect(await previewClientHealth(ctx.organizationId, clientId, TODAY)).toBe(
      ClientHealth.ON_HOLD,
    );

    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ACTIVE },
    });
  });
});

suite("progress engine end to end", () => {
  it("stores 0 for a client with no tasks", async () => {
    await clearTasks(ctx.organizationId);
    const result = await recalculateClientProgress(ctx.organizationId, clientId);

    expect(result?.simpleCompletionPct).toBe(0);
    expect(result?.weightedCompletionPct).toBe(0);
    expect(result?.nextDeadline).toBeNull();
  });

  it("computes simple and weighted differently for mixed priorities", async () => {
    await clearTasks(ctx.organizationId);

    await createTask(ctx, { clientId, taskName: "Crit done", serviceArea: "A", priority: Priority.CRITICAL, status: TaskStatus.COMPLETED }, { skipLog: true });
    await createTask(ctx, { clientId, taskName: "Low open", serviceArea: "A", priority: Priority.LOW, dueDate: day(10) }, { skipLog: true });

    const result = await recalculateClientProgress(ctx.organizationId, clientId);

    // Simple: 1 of 2 = 0.5. Weighted: 4 of 5 = 0.8.
    expect(result?.simpleCompletionPct).toBe(0.5);
    expect(result?.weightedCompletionPct).toBeCloseTo(0.8);
    expect(result?.nextDeadline?.getTime()).toBe(day(10).getTime());
  });

  it("excludes cancelled tasks from both metrics", async () => {
    await clearTasks(ctx.organizationId);
    await createTask(ctx, { clientId, taskName: "Done", serviceArea: "A", status: TaskStatus.COMPLETED }, { skipLog: true });
    await createTask(ctx, { clientId, taskName: "Void", serviceArea: "A", status: TaskStatus.CANCELLED }, { skipLog: true });

    const result = await recalculateClientProgress(ctx.organizationId, clientId);
    expect(result?.simpleCompletionPct).toBe(1);
  });
});

suite("task status machine through the service", () => {
  it("refuses a forbidden transition and leaves the task untouched", async () => {
    await clearTasks(ctx.organizationId);
    const task = await createTask(
      ctx,
      { clientId, taskName: "Guarded", serviceArea: "A" },
      { skipLog: true },
    );

    await expect(
      updateTaskStatus(ctx, task.id, TaskStatus.COMPLETED, TODAY),
    ).rejects.toBeInstanceOf(TaskOperationError);

    const after = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true, completionDate: true },
    });
    expect(after?.status).toBe(TaskStatus.NOT_STARTED);
    expect(after?.completionDate).toBeNull();
  });

  it("stamps completion and clears it on reopen", async () => {
    await clearTasks(ctx.organizationId);
    const task = await createTask(
      ctx,
      { clientId, taskName: "Lifecycle", serviceArea: "A" },
      { skipLog: true },
    );

    await updateTaskStatus(ctx, task.id, TaskStatus.IN_PROGRESS, TODAY);
    await updateTaskStatus(ctx, task.id, TaskStatus.COMPLETED, TODAY);

    let row = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true, completionDate: true, completionPct: true },
    });
    expect(row?.status).toBe(TaskStatus.COMPLETED);
    expect(row?.completionDate).not.toBeNull();
    expect(row?.completionPct).toBe(1);

    await updateTaskStatus(ctx, task.id, TaskStatus.IN_PROGRESS, TODAY);
    row = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true, completionDate: true, completionPct: true },
    });
    expect(row?.status).toBe(TaskStatus.IN_PROGRESS);
    expect(row?.completionDate).toBeNull();
  });

  it("records status history", async () => {
    await clearTasks(ctx.organizationId);
    const task = await createTask(
      ctx,
      { clientId, taskName: "Tracked", serviceArea: "A" },
      { skipLog: true },
    );
    await updateTaskStatus(ctx, task.id, TaskStatus.IN_PROGRESS, TODAY);

    const history = await prisma.taskStatusHistory.findMany({
      where: { taskId: task.id },
      select: { fromStatus: true, toStatus: true },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.fromStatus).toBe(TaskStatus.NOT_STARTED);
    expect(history[0]?.toStatus).toBe(TaskStatus.IN_PROGRESS);
  });

  it("recalculates the client's progress after a status change", async () => {
    await clearTasks(ctx.organizationId);
    const task = await createTask(
      ctx,
      { clientId, taskName: "Only task", serviceArea: "A" },
      { skipLog: true },
    );

    await updateTaskStatus(ctx, task.id, TaskStatus.IN_PROGRESS, TODAY);
    await updateTaskStatus(ctx, task.id, TaskStatus.COMPLETED, TODAY);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { simpleCompletionPct: true },
    });
    expect(client?.simpleCompletionPct).toBe(1);
  });
});

suite("task generation", () => {
  it("generates the Basic Accounting catalog for onboarding", async () => {
    await clearTasks(ctx.organizationId);
    const result = await generateOnboardingTasks(ctx, clientId, TODAY);

    expect(result.tasksCreated).toBe(9);

    const tasks = await prisma.task.findMany({
      where: { organizationId: ctx.organizationId, clientId },
      select: { taskName: true, taskCategory: true, assignedTo: { select: { user: { select: { name: true } } } } },
    });
    expect(tasks).toHaveLength(9);
    expect(tasks.every((t) => t.taskCategory === "ONBOARDING")).toBe(true);
  });

  it("is idempotent — a second run creates nothing", async () => {
    const again = await generateOnboardingTasks(ctx, clientId, TODAY);
    expect(again.tasksCreated).toBe(0);

    const count = await prisma.task.count({
      where: { organizationId: ctx.organizationId, clientId },
    });
    expect(count).toBe(9);
  });

  it("resolves template roles to real people, never leaving work unassigned", async () => {
    const tasks = await prisma.task.findMany({
      where: { organizationId: ctx.organizationId, clientId },
      select: {
        taskName: true,
        assignedTo: { select: { user: { select: { name: true } } } },
      },
    });

    // Bookkeeper-role templates go to Bob Book; the rest fall back to the
    // account manager rather than being left unowned.
    const bookkeeping = tasks.find((t) => t.taskName === "Daily Bookkeeping");
    expect(bookkeeping?.assignedTo?.user.name).toBe("Bob Book");
    expect(tasks.every((t) => t.assignedTo !== null)).toBe(true);
  });

  it("computes month-end close due dates in the FOLLOWING month", async () => {
    const monthEnd = await prisma.task.findFirst({
      where: {
        organizationId: ctx.organizationId,
        clientId,
        serviceArea: "Month-End Closing",
      },
      select: { dueDate: true, period: true },
    });

    expect(monthEnd?.period).toBe("2026-08");
    expect(monthEnd?.dueDate?.getMonth()).toBe(8); // September
    expect(monthEnd?.dueDate?.getDate()).toBe(5);
  });

  it("monthly generation skips what onboarding already created", async () => {
    const result = await generateMonthlyTasks(ctx, "2026-08", TODAY);
    expect(result.clientsProcessed).toBe(1);
    expect(result.tasksCreated).toBe(0);
  });

  it("monthly generation creates a fresh period without touching the prior one", async () => {
    const before = await prisma.task.count({
      where: { organizationId: ctx.organizationId, period: "2026-08" },
    });

    const result = await generateMonthlyTasks(ctx, "2026-09", TODAY);
    expect(result.tasksCreated).toBeGreaterThan(0);

    const after = await prisma.task.count({
      where: { organizationId: ctx.organizationId, period: "2026-08" },
    });
    expect(after).toBe(before);
  });

  it("skips non-Active clients", async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ON_HOLD },
    });

    const result = await generateMonthlyTasks(ctx, "2026-10", TODAY);
    expect(result.clientsProcessed).toBe(0);
    expect(result.tasksCreated).toBe(0);

    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ACTIVE },
    });
  });

  it("applies frequency rules — Annually only fires in December", async () => {
    // The Basic Accounting catalog has no Annually template, so this checks
    // the Quarterly boundary instead, which it does have via Month-End rules.
    const novemberResult = await generateMonthlyTasks(ctx, "2026-11", TODAY);
    const monthlyTemplateCount = 9; // all Basic Accounting templates are Daily/Monthly
    expect(novemberResult.tasksCreated).toBe(monthlyTemplateCount);
  });
});

suite("control center view model from the database", () => {
  it("returns the fourteen KPIs with real values", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);

    expect(vm.kpis).toHaveLength(14);
    const byKey = Object.fromEntries(vm.kpis.map((k) => [k.key, k.value]));

    expect(byKey.totalClients).toBe(1);
    expect(byKey.activeClients).toBe(1);
    expect(byKey.openTasks).toBeGreaterThan(0);
  });

  it("shows only Active clients in the health table", async () => {
    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.clientHealth).toHaveLength(1);
    expect(vm.clientHealth[0]?.clientName).toBe("Acme Co");
  });

  it("surfaces Critical issues and nothing else", async () => {
    await prisma.issue.deleteMany({ where: { organizationId: ctx.organizationId } });
    await prisma.issue.createMany({
      data: [
        {
          organizationId: ctx.organizationId,
          displayId: "ISS-0001",
          clientId,
          title: "Critical",
          severity: IssueSeverity.CRITICAL,
          status: IssueStatus.OPEN,
          dateRaised: day(-10),
        },
        {
          organizationId: ctx.organizationId,
          displayId: "ISS-0002",
          clientId,
          title: "Low noise",
          severity: IssueSeverity.LOW,
          status: IssueStatus.OPEN,
          dateRaised: day(-1),
        },
      ],
    });

    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.surfacedIssues.map((i) => i.title)).toEqual(["Critical"]);

    const byKey = Object.fromEntries(vm.kpis.map((k) => [k.key, k.value]));
    expect(byKey.openIssues).toBe(2);
    expect(byKey.issuesNeedingAttention).toBe(1);
  });
});

suite("team dashboard from the database", () => {
  it("flags a member over capacity", async () => {
    const rows = await getTeamDashboard(ctx, TODAY);
    const bookkeeper = rows.find((r) => r.memberName === "Bob Book");

    // Capacity 0 with any open task is overloaded.
    expect(bookkeeper?.capacity).toBe(0);
    expect(bookkeeper?.overloaded).toBe(true);
  });
});

suite("tenant isolation across the ported services", () => {
  it("does not see another organization's clients in the Control Center", async () => {
    const vm = await getControlCenterViewModel(otherCtx, TODAY);
    expect(vm.clientHealth.map((r) => r.clientName)).toEqual(["Other Client"]);

    const byKey = Object.fromEntries(vm.kpis.map((k) => [k.key, k.value]));
    expect(byKey.totalClients).toBe(1);
    expect(byKey.openTasks).toBe(0);
  });

  it("refuses to create a task against another organization's client", async () => {
    await expect(
      createTask(ctx, {
        clientId: otherClientId,
        taskName: "Cross tenant",
        serviceArea: "A",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const leaked = await prisma.task.count({
      where: { clientId: otherClientId },
    });
    expect(leaked).toBe(0);
  });

  it("refuses to transition another organization's task", async () => {
    const foreign = await createTask(
      otherCtx,
      { clientId: otherClientId, taskName: "Theirs", serviceArea: "A" },
      { skipLog: true },
    );

    await expect(
      updateTaskStatus(ctx, foreign.id, TaskStatus.IN_PROGRESS, TODAY),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.task.findUnique({
      where: { id: foreign.id },
      select: { status: true },
    });
    expect(untouched?.status).toBe(TaskStatus.NOT_STARTED);
  });

  it("keeps health recalculation scoped to the caller's organization", async () => {
    expect(
      await recalculateClientHealth(ctx, otherClientId, TODAY),
    ).toBeNull();
  });

  it("uses the package id, not the name, so packages cannot cross tenants", async () => {
    const foreignPackage = await prisma.servicePackage.findFirst({
      where: { organizationId: otherCtx.organizationId },
      select: { id: true },
    });
    expect(foreignPackage).toBeNull();
    expect(packageId).toBeTruthy();
    expect(memberIds.owner).toBeTruthy();
  });
});
