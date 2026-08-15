import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  EntityType,
  OrgRole,
  Priority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  SYSTEM_ACTOR_EMAIL,
  systemContext,
  type OrgContext,
} from "@/server/context";
import { runDailyRecalculation } from "@/server/jobs/scheduled";
import { ACTIVITY_ACTIONS } from "@/server/services/activity";
import {
  activityActorLabel,
  getActivityFilterOptions,
  getEntityActivity,
  listActivity,
} from "@/server/services/activity-queries";
import { seedOrgSettings } from "@/server/services/settings";
import { bulkReassign } from "@/server/services/task-mutations";
import { createTask, updateTaskStatus } from "@/server/services/tasks";

/**
 * Phase 11 integration tests — the Activity Log screen.
 *
 * The WRITE side is a port of legacy `ActivityLogger.gs` and was proven in
 * Phase 3. What is new here is the reader, so these tests assert two things
 * the screen depends on and one thing it must never do:
 *
 *  - filters select the right rows, including the SYSTEM actor a scheduled run
 *    writes and the deleted-user case the email snapshot exists for;
 *  - the feed is scoped to one organization;
 *  - there is no write path.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-activity";
const RIVAL_SLUG = "test-org-activity-rival";
const EMAIL_DOMAIN = "@activity-test.example.com";

const TODAY = new Date(2026, 7, 15);

let ctx: OrgContext;
let rivalCtx: OrgContext;
let memberId: string;
let secondMemberId: string;
let clientId: string;
let secondClientId: string;
let taskId: string;

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, RIVAL_SLUG] } },
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
    },
    select: { id: true },
  });

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 1 },
      { organizationId: org.id, entity: "CLIENT", lastValue: 0 },
      { organizationId: org.id, entity: "TASK", lastValue: 0 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
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

  return { org, member, context };
}

async function makeClient(
  organizationId: string,
  sequence: number,
  name: string,
) {
  const client = await prisma.client.create({
    data: {
      organizationId,
      displayId: formatDisplayId("CLIENT", sequence),
      name,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      health: ClientHealth.ON_TRACK,
      priority: Priority.MEDIUM,
    },
    select: { id: true },
  });
  return client.id;
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const main = await buildOrg(SLUG, "Activity Test Org", "primary");
  ctx = main.context;
  memberId = main.member.id;

  const secondUser = await prisma.user.create({
    data: {
      name: "Sam Second",
      email: `primary-second${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true },
  });
  const secondMember = await prisma.organizationMember.create({
    data: {
      organizationId: ctx.organizationId,
      userId: secondUser.id,
      displayId: formatDisplayId("MEMBER", 2),
      role: OrgRole.ACCOUNTANT,
    },
    select: { id: true },
  });
  secondMemberId = secondMember.id;

  clientId = await makeClient(ctx.organizationId, 1, "Alpha Client");
  secondClientId = await makeClient(ctx.organizationId, 2, "Beta Client");

  // A small, known history: create → status change → bulk reassign.
  const task = await createTask(ctx, {
    clientId,
    taskName: "Reconcile bank",
    serviceArea: "Bookkeeping",
    assignedToId: memberId,
    dueDate: new Date(2026, 7, 20),
  });
  taskId = task.id;

  await updateTaskStatus(ctx, taskId, TaskStatus.IN_PROGRESS, TODAY);
  await bulkReassign(ctx, [taskId], secondMemberId);

  await createTask(ctx, {
    clientId: secondClientId,
    taskName: "Beta task",
    serviceArea: "Payroll",
    assignedToId: null,
  });

  const rival = await buildOrg(RIVAL_SLUG, "Rival Org", "rival");
  rivalCtx = rival.context;
  const rivalClientId = await makeClient(
    rivalCtx.organizationId,
    1,
    "Rival Client",
  );
  await createTask(rivalCtx, {
    clientId: rivalClientId,
    taskName: "Rival secret task",
    serviceArea: "Bookkeeping",
    assignedToId: null,
  });
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

const query = (overrides: Record<string, unknown> = {}) =>
  ({ page: 1, ...overrides }) as Parameters<typeof listActivity>[1];

suite("listActivity", () => {
  it("returns the organization's history, newest first", async () => {
    const result = await listActivity(ctx, query());

    expect(result.total).toBeGreaterThanOrEqual(4);
    expect(result.rows.map((row) => row.action)).toContain(
      ACTIVITY_ACTIONS.TASK_CREATED,
    );

    for (let i = 1; i < result.rows.length; i += 1) {
      expect(
        result.rows[i - 1]!.createdAt.getTime(),
      ).toBeGreaterThanOrEqual(result.rows[i]!.createdAt.getTime());
    }
  });

  it("never returns another organization's entries", async () => {
    const result = await listActivity(ctx, query());
    const titles = result.rows.map((row) => row.newValue ?? "");

    expect(titles.some((value) => value.includes("Rival secret"))).toBe(false);

    // And the rival sees only their own.
    const theirs = await listActivity(rivalCtx, query());
    expect(theirs.rows.every((row) => row.action.length > 0)).toBe(true);
    expect(
      theirs.rows.some((row) => (row.newValue ?? "").includes("Reconcile bank")),
    ).toBe(false);
  });

  it("filters by client", async () => {
    const result = await listActivity(ctx, query({ clientId: secondClientId }));

    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.clientId === secondClientId)).toBe(
      true,
    );
  });

  it("filters by entity type and by action", async () => {
    const byEntity = await listActivity(
      ctx,
      query({ entityType: EntityType.TASK }),
    );
    expect(byEntity.total).toBeGreaterThan(0);
    expect(
      byEntity.rows.every((row) => row.entityType === EntityType.TASK),
    ).toBe(true);

    const byAction = await listActivity(
      ctx,
      query({ action: ACTIVITY_ACTIONS.TASK_STATUS_CHANGED }),
    );
    expect(byAction.total).toBe(1);
    expect(byAction.rows[0]?.previousValue).toBe("Not Started");
    expect(byAction.rows[0]?.newValue).toBe("In Progress");
  });

  it("filters by the acting user", async () => {
    const result = await listActivity(ctx, query({ userId: ctx.userId }));

    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.userEmail === ctx.userEmail)).toBe(
      true,
    );
  });

  it("searches across action, values, and client name", async () => {
    const byValue = await listActivity(ctx, query({ q: "Reconcile" }));
    expect(byValue.total).toBeGreaterThan(0);

    const byClient = await listActivity(ctx, query({ q: "Beta" }));
    expect(byClient.total).toBeGreaterThan(0);

    const nothing = await listActivity(ctx, query({ q: "zzz-no-match-zzz" }));
    expect(nothing.total).toBe(0);
    expect(nothing.rows).toEqual([]);
  });

  it("includes an entry written later the same day as the `to` date", async () => {
    // `to` is a date, and an entry written at 14:20 must be inside the range.
    // Comparing against midnight would silently exclude almost everything.
    const stamp = new Date(2026, 5, 10, 14, 20);
    await prisma.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: formatDisplayId("ACTIVITY", 9001),
        userId: ctx.userId,
        userEmail: ctx.userEmail,
        entityType: EntityType.SYSTEM,
        action: "Range Probe",
        createdAt: stamp,
      },
    });

    const inside = await listActivity(
      ctx,
      query({ from: new Date(2026, 5, 10), to: new Date(2026, 5, 10) }),
    );
    expect(inside.rows.some((row) => row.action === "Range Probe")).toBe(true);

    const before = await listActivity(
      ctx,
      query({ from: new Date(2026, 5, 11), to: new Date(2026, 5, 12) }),
    );
    expect(before.rows.some((row) => row.action === "Range Probe")).toBe(false);
  });

  it("paginates without repeating a row across pages", async () => {
    const all = await listActivity(ctx, query());
    const ids = new Set(all.rows.map((row) => row.id));
    expect(ids.size).toBe(all.rows.length);

    // Past the end lands on the last page rather than showing nothing.
    const far = await listActivity(ctx, query({ page: 999 }));
    expect(far.page).toBe(far.pageCount);
    expect(far.rows.length).toBeGreaterThan(0);
  });

  it("writes ONE summary entry for a bulk reassignment, not one per task", async () => {
    // Legacy's rule that bulk operations do not flood the feed.
    const result = await listActivity(
      ctx,
      query({ action: ACTIVITY_ACTIONS.TASK_REASSIGNED }),
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.entityId).toBeNull();
    expect(result.rows[0]?.newValue).toContain("1 task(s)");
  });
});

suite("the scheduled actor", () => {
  it("records a nightly pass as the system, not as a person", async () => {
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    // Force a real health transition so the pass has something to log:
    // recalculation that changes nothing is deliberately never logged.
    await prisma.client.update({
      where: { id: clientId },
      data: { health: ClientHealth.DELAYED },
    });
    await runDailyRecalculation(jobCtx, TODAY);

    const result = await listActivity(ctx, query({ userId: "SYSTEM" }));

    expect(result.total).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.system).toBe(true);
      expect(row.userEmail).toBe(SYSTEM_ACTOR_EMAIL);
      expect(activityActorLabel(row)).toBe("Scheduled job");
    }
  });

  it("distinguishes the system from an entry whose author was deleted", async () => {
    // Both have a null userId. Only one is a scheduled run, and conflating
    // them would attribute a person's work to the machine.
    const ghost = await prisma.user.create({
      data: {
        name: "Gone Away",
        email: `primary-ghost${EMAIL_DOMAIN}`,
        passwordHash: "unused",
      },
      select: { id: true, email: true },
    });
    await prisma.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: formatDisplayId("ACTIVITY", 9002),
        userId: ghost.id,
        userEmail: ghost.email,
        entityType: EntityType.CLIENT,
        entityId: clientId,
        clientId,
        action: "Ghost Action",
        newValue: "written by someone since removed",
      },
    });

    // Deleting the user nulls the FK (onDelete: SetNull) but the email
    // snapshot survives — audit D4's reason for storing it.
    await prisma.user.delete({ where: { id: ghost.id } });

    const byAction = await listActivity(ctx, query({ action: "Ghost Action" }));
    const row = byAction.rows[0];
    expect(row).toBeDefined();
    expect(row!.userName).toBeNull();
    expect(row!.system).toBe(false);
    expect(activityActorLabel(row!)).toBe(ghost.email);

    // And the SYSTEM filter must not pick it up.
    const asSystem = await listActivity(ctx, query({ userId: "SYSTEM" }));
    expect(asSystem.rows.some((r) => r.action === "Ghost Action")).toBe(false);
  });
});

suite("getActivityFilterOptions", () => {
  it("lists this organization's clients, users, and actions only", async () => {
    const options = await getActivityFilterOptions(ctx);

    expect(options.clients.map((c) => c.name)).toEqual([
      "Alpha Client",
      "Beta Client",
    ]);
    expect(options.users.map((u) => u.name)).toContain("Sam Second");
    expect(options.users.some((u) => u.name === "rival Owner")).toBe(false);

    // Actions come from the DATA, not from ACTIVITY_ACTIONS, so imported
    // legacy history stays selectable.
    expect(options.actions).toContain(ACTIVITY_ACTIONS.TASK_CREATED);
    expect(options.actions).toContain("Ghost Action");
    expect(new Set(options.actions).size).toBe(options.actions.length);

    expect(options.hasSystemEntries).toBe(true);
  });

  it("reports no system entries for an organization that has never run a job", async () => {
    const options = await getActivityFilterOptions(rivalCtx);
    expect(options.hasSystemEntries).toBe(false);
  });
});

suite("getEntityActivity", () => {
  it("returns one record's timeline", async () => {
    const rows = await getEntityActivity(ctx, EntityType.TASK, taskId);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.entityId === taskId)).toBe(true);
    expect(rows.map((row) => row.action)).toContain(
      ACTIVITY_ACTIONS.TASK_STATUS_CHANGED,
    );
  });

  it("returns nothing for an id belonging to another organization", async () => {
    const rivalTask = await prisma.task.findFirstOrThrow({
      where: { organizationId: rivalCtx.organizationId },
      select: { id: true },
    });

    const rows = await getEntityActivity(ctx, EntityType.TASK, rivalTask.id);
    expect(rows).toEqual([]);
  });
});

suite("the log is append-only", () => {
  it("exposes no write function from the query module", async () => {
    const queries = await import("@/server/services/activity-queries");

    for (const name of Object.keys(queries)) {
      expect(
        /^(create|update|delete|remove|edit)/i.test(name),
        `activity-queries exports a write function: ${name}`,
      ).toBe(false);
    }
  });
});
