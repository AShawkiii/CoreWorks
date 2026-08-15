import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  Frequency,
  IssueSeverity,
  IssueStatus,
  OrgRole,
  Priority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import { buildTaskTemplateCatalog } from "@/lib/domain/task-template-catalog";
import { systemContext, type OrgContext } from "@/server/context";
import {
  forEachOrganization,
  runDailyRecalculation,
  runMonthlyGeneration,
} from "@/server/jobs/scheduled";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 10 integration tests — the scheduled jobs (audit §9).
 *
 * The daily pass is the one the audit calls out as necessary rather than
 * convenient: **overdue-ness is time-dependent, not event-dependent**, so a
 * client's health goes stale as the date rolls over with nobody editing
 * anything. That is what the first suite here reproduces.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-jobs";
const OTHER_SLUG = "test-org-jobs-other";
const EMAIL_DOMAIN = "@jobs-test.example.com";

const TODAY = new Date(2026, 7, 15);
const LATER = new Date(2026, 7, 25);

let ctx: OrgContext;
let clientId: string;
let packageId: string;

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
      name: "Jane AM",
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
      jobTitle: "Bookkeeper",
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

  const catalog = buildTaskTemplateCatalog().filter(
    (entry) => entry.servicePackage === "Basic Accounting",
  );
  for (const [index, entry] of catalog.entries()) {
    await prisma.taskTemplate.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("TASK_TEMPLATE", index + 1),
        servicePackageId: pkg.id,
        serviceArea: entry.serviceArea,
        taskName: entry.taskName,
        frequency: entry.frequency,
        priority: entry.priority,
        defaultAssigneeRole: entry.defaultAssigneeRole,
        typicalDurationDays: entry.typicalDurationDays,
        requiresClientInput: entry.requiresClientInput,
      },
    });
  }

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 1 },
      { organizationId: org.id, entity: "CLIENT", lastValue: 0 },
      { organizationId: org.id, entity: "TASK", lastValue: 0 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
      { organizationId: org.id, entity: "SERVICE_PACKAGE", lastValue: 1 },
      {
        organizationId: org.id,
        entity: "TASK_TEMPLATE",
        lastValue: catalog.length,
      },
    ],
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

  const main = await buildOrg(SLUG, "Jobs Test Org", "primary");
  ctx = main.context;
  packageId = main.pkg.id;

  const client = await prisma.client.create({
    data: {
      organizationId: main.org.id,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Jobs Client",
      servicePackageId: packageId,
      accountManagerId: main.member.id,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      health: ClientHealth.ON_TRACK,
      priority: Priority.MEDIUM,
    },
    select: { id: true },
  });
  clientId = client.id;
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("runDailyRecalculation", () => {
  it("catches a client going Delayed purely because the date moved", async () => {
    // The audit's exact justification for keeping this job: nothing about the
    // task changes, only the calendar.
    await prisma.task.deleteMany({ where: { clientId } });
    await prisma.client.update({
      where: { id: clientId },
      data: { health: ClientHealth.ON_TRACK },
    });

    // Three tasks due on the 20th: not overdue on the 15th, overdue on the
    // 25th. Three overdue tasks is the Delayed threshold (audit §6.1).
    for (let i = 0; i < 3; i += 1) {
      await prisma.task.create({
        data: {
          organizationId: ctx.organizationId,
          displayId: formatDisplayId("TASK", 500 + i),
          clientId,
          taskName: `Rollover task ${i}`,
          serviceArea: "Bookkeeping",
          status: TaskStatus.IN_PROGRESS,
          dueDate: new Date(2026, 7, 20),
          priority: Priority.MEDIUM,
        },
      });
    }

    await runDailyRecalculation(ctx, TODAY);
    const before = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true },
    });
    expect(before.health).toBe(ClientHealth.ON_TRACK);

    // Same data, later date, no edits at all.
    const result = await runDailyRecalculation(ctx, LATER);
    const after = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true },
    });
    expect(after.health).toBe(ClientHealth.DELAYED);
    expect(Number(result.details.healthChanged)).toBeGreaterThan(0);
  });

  it("rewrites stored completion from the current tasks", async () => {
    await prisma.task.deleteMany({ where: { clientId } });
    await prisma.client.update({
      where: { id: clientId },
      data: { simpleCompletionPct: 0.99, weightedCompletionPct: 0.99 },
    });

    for (const [i, status] of [
      TaskStatus.COMPLETED,
      TaskStatus.IN_PROGRESS,
    ].entries()) {
      await prisma.task.create({
        data: {
          organizationId: ctx.organizationId,
          displayId: formatDisplayId("TASK", 600 + i),
          clientId,
          taskName: `Progress task ${i}`,
          serviceArea: "Bookkeeping",
          status,
          priority: Priority.MEDIUM,
        },
      });
    }

    await runDailyRecalculation(ctx, TODAY);

    const row = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { simpleCompletionPct: true },
    });
    // The stale 0.99 is replaced by the real one of two.
    expect(Number(row.simpleCompletionPct)).toBeCloseTo(0.5, 10);
  });

  it("reports what it processed", async () => {
    const result = await runDailyRecalculation(ctx, TODAY);
    expect(result.job).toBe("daily-recalculation");
    expect(result.organizationId).toBe(ctx.organizationId);
    expect(Number(result.details.clientsProcessed)).toBeGreaterThan(0);
    expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(
      result.startedAt.getTime(),
    );
  });

  it("is idempotent — a second pass changes nothing", async () => {
    await runDailyRecalculation(ctx, TODAY);
    const first = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true, simpleCompletionPct: true },
    });

    const second = await runDailyRecalculation(ctx, TODAY);
    const after = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true, simpleCompletionPct: true },
    });

    expect(after.health).toBe(first.health);
    expect(Number(after.simpleCompletionPct)).toBeCloseTo(
      Number(first.simpleCompletionPct),
      10,
    );
    expect(Number(second.details.healthChanged)).toBe(0);
  });
});

suite("runMonthlyGeneration", () => {
  it("creates the period's recurring tasks", async () => {
    await prisma.task.deleteMany({ where: { clientId } });

    const result = await runMonthlyGeneration(ctx, "2026-08", TODAY);
    expect(result.job).toBe("monthly-generation");
    expect(result.details.period).toBe("2026-08");
    expect(Number(result.details.tasksCreated)).toBeGreaterThan(0);

    const created = await prisma.task.count({
      where: { clientId, period: "2026-08" },
    });
    expect(created).toBe(Number(result.details.tasksCreated));
  });

  it("is safe to re-run — the dedupe key stops duplicates", async () => {
    // clientId|serviceArea|taskName|period (audit §6.11). This is what makes
    // the manual button as safe as the monthly trigger.
    const before = await prisma.task.count({
      where: { clientId, period: "2026-08" },
    });

    const again = await runMonthlyGeneration(ctx, "2026-08", TODAY);
    expect(Number(again.details.tasksCreated)).toBe(0);

    const after = await prisma.task.count({
      where: { clientId, period: "2026-08" },
    });
    expect(after).toBe(before);
  });

  it("never touches a prior period", async () => {
    const augustIds = await prisma.task.findMany({
      where: { clientId, period: "2026-08" },
      select: { id: true, status: true },
    });
    // Mark one August task complete, then generate September.
    await prisma.task.update({
      where: { id: augustIds[0]!.id },
      data: { status: TaskStatus.COMPLETED },
    });

    await runMonthlyGeneration(ctx, "2026-09", new Date(2026, 8, 1));

    const august = await prisma.task.findMany({
      where: { clientId, period: "2026-08" },
      select: { id: true, status: true },
    });
    expect(august).toHaveLength(augustIds.length);
    expect(
      august.find((t) => t.id === augustIds[0]!.id)?.status,
    ).toBe(TaskStatus.COMPLETED);

    const september = await prisma.task.count({
      where: { clientId, period: "2026-09" },
    });
    expect(september).toBeGreaterThan(0);
  });

  it("skips clients that are not Active", async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ON_HOLD },
    });

    const result = await runMonthlyGeneration(ctx, "2026-10", TODAY);
    expect(Number(result.details.tasksCreated)).toBe(0);
    expect(
      await prisma.task.count({ where: { clientId, period: "2026-10" } }),
    ).toBe(0);

    await prisma.client.update({
      where: { id: clientId },
      data: { contractStatus: ContractStatus.ACTIVE },
    });
  });

  it("defaults to the current period when none is given", async () => {
    const result = await runMonthlyGeneration(ctx, undefined, TODAY);
    expect(result.details.period).toBe("2026-08");
  });

  it("skips an inactive template", async () => {
    await prisma.task.deleteMany({ where: { clientId, period: "2026-11" } });
    const template = await prisma.taskTemplate.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, frequency: Frequency.MONTHLY },
      select: { id: true, taskName: true },
    });
    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { isActive: false },
    });

    await runMonthlyGeneration(ctx, "2026-11", TODAY);
    const made = await prisma.task.findMany({
      where: { clientId, period: "2026-11" },
      select: { taskName: true },
    });
    expect(made.some((t) => t.taskName === template.taskName)).toBe(false);

    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { isActive: true },
    });
  });
});

suite("forEachOrganization", () => {
  it("runs across every organization and reports each", async () => {
    const other = await buildOrg(OTHER_SLUG, "Jobs Other Org", "secondary");
    await prisma.client.create({
      data: {
        organizationId: other.org.id,
        displayId: formatDisplayId("CLIENT", 1),
        name: "Neighbour",
        servicePackageId: other.pkg.id,
        accountManagerId: other.member.id,
        startDate: new Date(2026, 0, 1),
        contractStatus: ContractStatus.ACTIVE,
        priority: Priority.MEDIUM,
      },
    });

    const { results, failures } = await forEachOrganization((c) =>
      runDailyRecalculation(c, TODAY),
    );

    expect(failures).toEqual([]);
    const slugs = results.map((r) => r.organizationSlug);
    expect(slugs).toContain(SLUG);
    expect(slugs).toContain(OTHER_SLUG);
  });

  it("writes activity with no user id but a system email", async () => {
    // A nightly pass is not a member of staff. ActivityLog.userId is nullable
    // for exactly this, with userEmail carrying the snapshot.
    const sys = systemContext(ctx.organizationId, ctx.organizationSlug, OrgRole.OWNER);
    expect(sys.userId).toBeNull();
    expect(sys.membershipId).toBeNull();
    expect(sys.userEmail).toBe("system@coreworks.local");

    await prisma.task.deleteMany({ where: { clientId, period: "2026-12" } });
    await runMonthlyGeneration(sys, "2026-12", TODAY);

    const entry = await prisma.activityLog.findFirst({
      where: {
        organizationId: ctx.organizationId,
        userEmail: "system@coreworks.local",
      },
      orderBy: { createdAt: "desc" },
      select: { userId: true, userEmail: true, action: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBeNull();
  });

  it("keeps one organization's failure from stopping the rest", async () => {
    const seen: string[] = [];
    const { results, failures } = await forEachOrganization(async (c) => {
      seen.push(c.organizationSlug);
      if (c.organizationSlug === SLUG) {
        throw new Error("deliberate failure");
      }
      return runDailyRecalculation(c, TODAY);
    });

    expect(seen).toContain(SLUG);
    expect(seen).toContain(OTHER_SLUG);
    expect(failures.map((f) => f.slug)).toContain(SLUG);
    expect(failures.find((f) => f.slug === SLUG)?.error).toBe(
      "deliberate failure",
    );
    // The neighbour still ran.
    expect(results.some((r) => r.organizationSlug === OTHER_SLUG)).toBe(true);
  });
});

suite("job scoping", () => {
  it("recalculates only the caller's organization", async () => {
    const other = await prisma.organization.findFirstOrThrow({
      where: { slug: OTHER_SLUG },
      select: { id: true },
    });
    const neighbourClient = await prisma.client.findFirstOrThrow({
      where: { organizationId: other.id },
      select: { id: true },
    });

    await prisma.client.update({
      where: { id: neighbourClient.id },
      data: { simpleCompletionPct: 0.77 },
    });

    await runDailyRecalculation(ctx, TODAY);

    const untouched = await prisma.client.findUniqueOrThrow({
      where: { id: neighbourClient.id },
      select: { simpleCompletionPct: true },
    });
    expect(Number(untouched.simpleCompletionPct)).toBeCloseTo(0.77, 10);
  });

  it("generates only into the caller's organization", async () => {
    const other = await prisma.organization.findFirstOrThrow({
      where: { slug: OTHER_SLUG },
      select: { id: true },
    });
    const before = await prisma.task.count({ where: { organizationId: other.id } });

    await runMonthlyGeneration(ctx, "2027-01", TODAY);

    const after = await prisma.task.count({ where: { organizationId: other.id } });
    expect(after).toBe(before);
  });
});

suite("issue-driven health still recalculates on the daily pass", () => {
  it("picks up an issue raised directly in the database", async () => {
    // An import or a direct write bypasses the event-driven recalculation;
    // the daily pass is the net that catches it.
    await prisma.issue.deleteMany({ where: { clientId } });
    await prisma.task.deleteMany({ where: { clientId } });
    await prisma.client.update({
      where: { id: clientId },
      data: { health: ClientHealth.ON_TRACK },
    });

    await prisma.issue.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: formatDisplayId("ISSUE", 900),
        clientId,
        title: "Raised out of band",
        severity: IssueSeverity.CRITICAL,
        status: IssueStatus.OPEN,
        dateRaised: TODAY,
      },
    });

    await runDailyRecalculation(ctx, TODAY);

    const row = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true },
    });
    // An open Critical issue forces Delayed (audit §6.1).
    expect(row.health).toBe(ClientHealth.DELAYED);
  });
});
