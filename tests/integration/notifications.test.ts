import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  IssueSeverity,
  NotificationType,
  OrgRole,
  Priority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import { systemContext, type OrgContext } from "@/server/context";
import { addComment } from "@/server/services/comments";
import { recalculateClientHealth } from "@/server/services/health";
import { createIssue } from "@/server/services/issues";
import {
  countUnreadNotifications,
  createNotifications,
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  notifyDueAndOverdueTasks,
  notifyMentions,
  notifySystem,
  setNotificationRead,
  updateNotificationPreferences,
} from "@/server/services/notifications";
import { createRequest } from "@/server/services/requests";
import { bulkReassign, updateTaskDetails } from "@/server/services/task-mutations";
import { createTask } from "@/server/services/tasks";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 11 integration tests — notifications.
 *
 * Notifications are NET-NEW (audit §15): legacy had no notification layer, so
 * nothing here is a parity test. What these assert is that the four rules in
 * `services/notifications.ts` actually hold against a real database —
 * particularly the two that are easy to get wrong and invisible in the UI:
 * self-notification, and cross-tenant addressing.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-notify";
const RIVAL_SLUG = "test-org-notify-rival";
const EMAIL_DOMAIN = "@notify-test.example.com";

const TODAY = new Date(2026, 7, 15);

interface Actor {
  userId: string;
  memberId: string;
  name: string;
  email: string;
}

let ctx: OrgContext;
let owner: Actor;
let worker: Actor;
let backup: Actor;
let inactive: Actor;
let clientId: string;

let rivalCtx: OrgContext;
let rivalMemberId: string;

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

async function addActor(
  organizationId: string,
  name: string,
  slugPrefix: string,
  role: OrgRole,
  sequence: number,
  isActive = true,
): Promise<Actor> {
  const email = `${slugPrefix}-${sequence}${EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: { name, email, passwordHash: "unused" },
    select: { id: true },
  });
  const member = await prisma.organizationMember.create({
    data: {
      organizationId,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", sequence),
      role,
      isActive,
    },
    select: { id: true },
  });
  return { userId: user.id, memberId: member.id, name, email };
}

async function buildOrg(slug: string, name: string) {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 10 },
      { organizationId: org.id, entity: "CLIENT", lastValue: 0 },
      { organizationId: org.id, entity: "TASK", lastValue: 0 },
      { organizationId: org.id, entity: "ISSUE", lastValue: 0 },
      { organizationId: org.id, entity: "CLIENT_REQUEST", lastValue: 0 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
    ],
  });

  return org;
}

/** Every notification currently addressed to one person, newest first. */
async function inboxOf(userId: string, type?: NotificationType) {
  return prisma.notification.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      type: true,
      title: true,
      body: true,
      href: true,
      entityId: true,
      readAt: true,
      organizationId: true,
    },
  });
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const org = await buildOrg(SLUG, "Notify Test Org");

  owner = await addActor(org.id, "Olivia Owner", "primary", OrgRole.OWNER, 1);
  worker = await addActor(
    org.id,
    "Wes Worker",
    "primary",
    OrgRole.ACCOUNTANT,
    2,
  );
  backup = await addActor(org.id, "Bea Backup", "primary", OrgRole.MANAGER, 3);
  inactive = await addActor(
    org.id,
    "Ivan Inactive",
    "primary",
    OrgRole.TEAM_MEMBER,
    4,
    false,
  );

  ctx = {
    userId: owner.userId,
    userEmail: owner.email,
    userName: owner.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: owner.memberId,
    role: OrgRole.OWNER,
  };

  const client = await prisma.client.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("CLIENT", 1),
      name: "Notify Client",
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      health: ClientHealth.ON_TRACK,
      priority: Priority.MEDIUM,
      accountManagerId: worker.memberId,
      backupMemberId: backup.memberId,
    },
    select: { id: true },
  });
  clientId = client.id;

  const rival = await buildOrg(RIVAL_SLUG, "Rival Org");
  const rivalOwner = await addActor(
    rival.id,
    "Rhea Rival",
    "rival",
    OrgRole.OWNER,
    1,
  );
  rivalMemberId = rivalOwner.memberId;
  rivalCtx = {
    userId: rivalOwner.userId,
    userEmail: rivalOwner.email,
    userName: rivalOwner.name,
    organizationId: rival.id,
    organizationSlug: rival.slug,
    membershipId: rivalOwner.memberId,
    role: OrgRole.OWNER,
  };
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!hasDatabase) return;
  await prisma.notification.deleteMany({
    where: { organizationId: { in: [ctx.organizationId, rivalCtx.organizationId] } },
  });
  await prisma.notificationPreference.deleteMany({
    where: { organizationId: ctx.organizationId },
  });
});

suite("createNotifications — the four delivery rules", () => {
  it("addresses a member's USER, not the member id", async () => {
    const created = await createNotifications(ctx, [
      {
        memberId: worker.memberId,
        type: NotificationType.SYSTEM,
        title: "Hello",
      },
    ]);

    expect(created).toBe(1);
    const inbox = await inboxOf(worker.userId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.title).toBe("Hello");
  });

  it("never notifies the actor about their own action", async () => {
    const created = await createNotifications(ctx, [
      {
        memberId: owner.memberId,
        type: NotificationType.TASK_ASSIGNED,
        title: "You did this yourself",
      },
    ]);

    expect(created).toBe(0);
    expect(await inboxOf(owner.userId)).toHaveLength(0);
  });

  it("notifies everyone when the actor is a scheduled run", async () => {
    // systemContext has a null userId, and null never equals a real user id,
    // so the nightly pass must not accidentally suppress anyone.
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    const created = await createNotifications(jobCtx, [
      { memberId: owner.memberId, type: NotificationType.SYSTEM, title: "Ran" },
      { memberId: worker.memberId, type: NotificationType.SYSTEM, title: "Ran" },
    ]);

    expect(created).toBe(2);
  });

  it("skips a deactivated member", async () => {
    const created = await createNotifications(ctx, [
      {
        memberId: inactive.memberId,
        type: NotificationType.SYSTEM,
        title: "Nope",
      },
    ]);

    expect(created).toBe(0);
    expect(await inboxOf(inactive.userId)).toHaveLength(0);
  });

  it("refuses a member id belonging to another organization", async () => {
    // The member exists — just not here. Resolving it would address this
    // organization's work to another tenant's staff.
    const created = await createNotifications(ctx, [
      {
        memberId: rivalMemberId,
        type: NotificationType.SYSTEM,
        title: "Cross-tenant",
      },
    ]);

    expect(created).toBe(0);
    expect(
      await prisma.notification.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
  });

  it("honours an explicit opt-out", async () => {
    await updateNotificationPreferences(
      { ...ctx, userId: worker.userId },
      { enabled: [] },
    );

    const created = await createNotifications(ctx, [
      {
        memberId: worker.memberId,
        type: NotificationType.MENTION,
        title: "Muted",
      },
    ]);

    expect(created).toBe(0);
  });

  it("ignores an opt-out for SYSTEM, which is not configurable", async () => {
    // Written directly, since the service and schema both refuse to store it.
    await prisma.notificationPreference.create({
      data: {
        organizationId: ctx.organizationId,
        userId: worker.userId,
        type: NotificationType.SYSTEM,
        enabled: false,
      },
    });

    const created = await createNotifications(ctx, [
      {
        memberId: worker.memberId,
        type: NotificationType.SYSTEM,
        title: "Cannot be muted",
      },
    ]);

    expect(created).toBe(1);
  });

  it("treats an absent preference row as enabled", async () => {
    expect(
      await prisma.notificationPreference.count({
        where: { userId: worker.userId },
      }),
    ).toBe(0);

    const created = await createNotifications(ctx, [
      {
        memberId: worker.memberId,
        type: NotificationType.MENTION,
        title: "Default on",
      },
    ]);

    expect(created).toBe(1);
  });
});

suite("assignment emitters", () => {
  it("notifies the assignee when a task is created for them", async () => {
    const task = await createTask(ctx, {
      clientId,
      taskName: "Reconcile bank",
      serviceArea: "Bookkeeping",
      assignedToId: worker.memberId,
      dueDate: new Date(2026, 7, 20),
    });

    const inbox = await inboxOf(worker.userId, NotificationType.TASK_ASSIGNED);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.entityId).toBe(task.id);
    expect(inbox[0]?.href).toBe(`/tasks/${task.id}`);
    expect(inbox[0]?.title).toContain("Reconcile bank");
  });

  it("sends nothing when a generated task is created with skipLog", async () => {
    // Bulk generation creates hundreds of rows in one pass. One notification
    // per row would bury every real one; the run sends a single summary.
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Generated task",
        serviceArea: "Bookkeeping",
        assignedToId: worker.memberId,
      },
      { skipLog: true },
    );

    expect(
      await inboxOf(worker.userId, NotificationType.TASK_ASSIGNED),
    ).toHaveLength(0);
  });

  it("notifies the new assignee on an edit, and only when it changed", async () => {
    const task = await createTask(ctx, {
      clientId,
      taskName: "Move me",
      serviceArea: "Bookkeeping",
      assignedToId: null,
    });
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    const base = {
      taskId: task.id,
      clientId,
      taskName: "Move me",
      serviceArea: "Bookkeeping",
      description: null,
      period: null,
      reviewerId: null,
      priority: Priority.MEDIUM,
      dueDate: null,
      startDate: null,
      reviewStatus: "NOT_REVIEWED" as const,
      clientDependency: false,
      waitingFor: null,
      notes: null,
    };

    await updateTaskDetails(ctx, { ...base, assignedToId: worker.memberId });
    expect(
      await inboxOf(worker.userId, NotificationType.TASK_ASSIGNED),
    ).toHaveLength(1);

    // Same assignee again: an edit that changed something else must not
    // re-notify, or every field edit becomes a ping.
    await updateTaskDetails(ctx, {
      ...base,
      taskName: "Move me (renamed)",
      assignedToId: worker.memberId,
    });
    expect(
      await inboxOf(worker.userId, NotificationType.TASK_ASSIGNED),
    ).toHaveLength(1);
  });

  it("sends nothing when an assignment is cleared", async () => {
    const task = await createTask(ctx, {
      clientId,
      taskName: "Unassign me",
      serviceArea: "Bookkeeping",
      assignedToId: worker.memberId,
    });
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    await updateTaskDetails(ctx, {
      taskId: task.id,
      clientId,
      taskName: "Unassign me",
      serviceArea: "Bookkeeping",
      description: null,
      period: null,
      assignedToId: null,
      reviewerId: null,
      priority: Priority.MEDIUM,
      dueDate: null,
      startDate: null,
      reviewStatus: "NOT_REVIEWED",
      clientDependency: false,
      waitingFor: null,
      notes: null,
    });

    expect(
      await prisma.notification.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
  });

  it("sends one notification per task on a bulk reassignment", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const task = await createTask(ctx, {
        clientId,
        taskName: `Bulk ${i}`,
        serviceArea: "Bookkeeping",
        assignedToId: null,
      });
      ids.push(task.id);
    }
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    const result = await bulkReassign(ctx, ids, worker.memberId);
    expect(result.updated).toBe(3);

    const inbox = await inboxOf(worker.userId, NotificationType.TASK_ASSIGNED);
    // One per task, unlike the single SUMMARY activity entry: a "you now own 3
    // tasks" notice the recipient cannot click through is not actionable.
    expect(inbox).toHaveLength(3);
    expect(new Set(inbox.map((row) => row.entityId))).toEqual(new Set(ids));
  });

  it("sends nothing on a bulk UNassignment", async () => {
    const task = await createTask(ctx, {
      clientId,
      taskName: "Bulk unassign",
      serviceArea: "Bookkeeping",
      assignedToId: worker.memberId,
    });
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    await bulkReassign(ctx, [task.id], null);
    expect(
      await prisma.notification.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
  });

  it("notifies on an issue and on a client request", async () => {
    const issue = await createIssue(
      ctx,
      {
        clientId,
        title: "Missing bank statement",
        category: null,
        impact: null,
        description: null,
        severity: IssueSeverity.HIGH,
        assignedToId: worker.memberId,
        dateRaised: TODAY,
        deadline: null,
        requiredAction: null,
        notes: null,
      },
      TODAY,
    );

    const request = await createRequest(
      ctx,
      {
        clientId,
        title: "Send payroll register",
        description: null,
        priority: Priority.MEDIUM,
        assignedToId: worker.memberId,
        requestedDate: TODAY,
        requiredBy: null,
        notes: null,
      },
      TODAY,
    );

    const issues = await inboxOf(
      worker.userId,
      NotificationType.ISSUE_ASSIGNED,
    );
    const requests = await inboxOf(
      worker.userId,
      NotificationType.REQUEST_ASSIGNED,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.entityId).toBe(issue.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.entityId).toBe(request.id);
  });
});

suite("client health", () => {
  it("notifies the account manager and backup, once each, on a real change", async () => {
    await prisma.task.deleteMany({ where: { clientId } });
    await prisma.issue.deleteMany({ where: { clientId } });
    await prisma.client.update({
      where: { id: clientId },
      data: { health: ClientHealth.ON_TRACK },
    });
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    // One open Critical issue forces Delayed (audit §6.1).
    await createIssue(
      ctx,
      {
        clientId,
        title: "Critical",
        category: null,
        impact: null,
        description: null,
        severity: IssueSeverity.CRITICAL,
        assignedToId: null,
        dateRaised: TODAY,
        deadline: null,
        requiredAction: null,
        notes: null,
      },
      TODAY,
    );

    const health = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { health: true },
    });
    expect(health.health).toBe(ClientHealth.DELAYED);

    expect(
      await inboxOf(worker.userId, NotificationType.CLIENT_HEALTH_CHANGED),
    ).toHaveLength(1);
    expect(
      await inboxOf(backup.userId, NotificationType.CLIENT_HEALTH_CHANGED),
    ).toHaveLength(1);
  });

  it("sends nothing when a recalculation confirms the same value", async () => {
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    // The client is already Delayed from the previous test's issue.
    await recalculateClientHealth(ctx, clientId, TODAY);
    await recalculateClientHealth(ctx, clientId, TODAY);

    expect(
      await prisma.notification.count({
        where: {
          organizationId: ctx.organizationId,
          type: NotificationType.CLIENT_HEALTH_CHANGED,
        },
      }),
    ).toBe(0);
  });
});

suite("mentions", () => {
  it("notifies a mentioned member from an issue comment", async () => {
    const issue = await createIssue(
      ctx,
      {
        clientId,
        title: "Discussion",
        category: null,
        impact: null,
        description: null,
        severity: IssueSeverity.LOW,
        assignedToId: null,
        dateRaised: TODAY,
        deadline: null,
        requiredAction: null,
        notes: null,
      },
      TODAY,
    );
    await prisma.notification.deleteMany({
      where: { organizationId: ctx.organizationId },
    });

    await addComment(ctx, "issue", issue.id, "@Wes Worker can you check this?");

    const inbox = await inboxOf(worker.userId, NotificationType.MENTION);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.href).toBe(`/issues/${issue.id}`);
    expect(inbox[0]?.title).toContain(ctx.userName);
    expect(inbox[0]?.body).toContain("can you check this");
  });

  it("does not notify a mention of yourself", async () => {
    await notifyMentions(ctx, `@${owner.name} note to self`, {
      href: "/tasks/x",
      entityType: "TASK",
      entityId: "x",
      label: "Something",
    });

    expect(await inboxOf(owner.userId, NotificationType.MENTION)).toHaveLength(
      0,
    );
  });

  it("does not notify a deactivated member", async () => {
    await notifyMentions(ctx, `@${inactive.name} are you there`, {
      href: "/tasks/x",
      entityType: "TASK",
      entityId: "x",
      label: "Something",
    });

    expect(
      await inboxOf(inactive.userId, NotificationType.MENTION),
    ).toHaveLength(0);
  });

  it("cannot mention someone in another organization", async () => {
    await notifyMentions(ctx, "@Rhea Rival take a look", {
      href: "/tasks/x",
      entityType: "TASK",
      entityId: "x",
      label: "Something",
    });

    // Scoped to the two test organizations, matching what `beforeEach` clears.
    // An unscoped count would also see rows belonging to the demo seed or to
    // whatever else shares this database, and fail for a reason unrelated to
    // the rule under test.
    expect(
      await prisma.notification.count({
        where: {
          type: NotificationType.MENTION,
          organizationId: {
            in: [ctx.organizationId, rivalCtx.organizationId],
          },
        },
      }),
    ).toBe(0);
    expect(
      await inboxOf(rivalCtx.userId!, NotificationType.MENTION),
    ).toHaveLength(0);
  });
});

suite("deadline reminders", () => {
  async function taskDue(
    name: string,
    dueDate: Date,
    // Annotated, not inferred: a default of NOT_STARTED narrows the parameter
    // to that one literal and rejects every other status at the call site.
    status: TaskStatus = TaskStatus.NOT_STARTED,
  ) {
    return createTask(
      ctx,
      {
        clientId,
        taskName: name,
        serviceArea: "Bookkeeping",
        assignedToId: worker.memberId,
        dueDate,
        status,
      },
      { skipLog: true },
    );
  }

  beforeEach(async () => {
    if (!hasDatabase) return;
    await prisma.task.deleteMany({ where: { clientId } });
  });

  it("reports due-soon and overdue separately", async () => {
    await taskDue("Due tomorrow", new Date(2026, 7, 16));
    await taskDue("Overdue", new Date(2026, 7, 10));
    await taskDue("Far off", new Date(2026, 8, 30));

    const result = await notifyDueAndOverdueTasks(ctx, TODAY);

    expect(result).toEqual({ dueSoon: 1, overdue: 1 });
    expect(
      await inboxOf(worker.userId, NotificationType.TASK_DUE_SOON),
    ).toHaveLength(1);
    expect(
      await inboxOf(worker.userId, NotificationType.TASK_OVERDUE),
    ).toHaveLength(1);
  });

  it("is safe to re-run on the same day", async () => {
    await taskDue("Overdue", new Date(2026, 7, 10));

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 0,
      overdue: 1,
    });
    // The same property the generation job has: running twice must not
    // double-send, or a retried cron becomes a duplicate storm.
    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 0,
      overdue: 0,
    });
    expect(
      await inboxOf(worker.userId, NotificationType.TASK_OVERDUE),
    ).toHaveLength(1);
  });

  it("sends again the next day, because the fact has changed", async () => {
    await taskDue("Overdue", new Date(2026, 7, 10));

    await notifyDueAndOverdueTasks(ctx, TODAY);
    await notifyDueAndOverdueTasks(ctx, new Date(2026, 7, 16));

    expect(
      await inboxOf(worker.userId, NotificationType.TASK_OVERDUE),
    ).toHaveLength(2);
  });

  it("promotes a task from due-soon to overdue as the date rolls over", async () => {
    await taskDue("Rolls over", new Date(2026, 7, 16));

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 1,
      overdue: 0,
    });
    // Nothing about the task changed — only the calendar. The audit's exact
    // justification for having a job on a clock at all (§9).
    expect(await notifyDueAndOverdueTasks(ctx, new Date(2026, 7, 17))).toEqual({
      dueSoon: 0,
      overdue: 1,
    });
  });

  it("ignores completed, cancelled, unassigned, and undated tasks", async () => {
    await taskDue("Done", new Date(2026, 7, 10), TaskStatus.COMPLETED);
    await taskDue("Void", new Date(2026, 7, 10), TaskStatus.CANCELLED);
    await createTask(
      ctx,
      {
        clientId,
        taskName: "Nobody's",
        serviceArea: "Bookkeeping",
        assignedToId: null,
        dueDate: new Date(2026, 7, 10),
      },
      { skipLog: true },
    );
    await createTask(
      ctx,
      {
        clientId,
        taskName: "No date",
        serviceArea: "Bookkeeping",
        assignedToId: worker.memberId,
        dueDate: null,
      },
      { skipLog: true },
    );

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 0,
      overdue: 0,
    });
  });

  it("honours the organization's due-soon window", async () => {
    await taskDue("Six days out", new Date(2026, 7, 21));

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 0,
      overdue: 0,
    });

    // The window is HEALTH_AT_RISK_DUE_SOON_DAYS — the same horizon the health
    // rule calls imminent, so the two cannot disagree about "soon".
    await prisma.organizationSetting.updateMany({
      where: {
        organizationId: ctx.organizationId,
        key: "HEALTH_AT_RISK_DUE_SOON_DAYS",
      },
      data: { value: "10" },
    });

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 1,
      overdue: 0,
    });

    await prisma.organizationSetting.updateMany({
      where: {
        organizationId: ctx.organizationId,
        key: "HEALTH_AT_RISK_DUE_SOON_DAYS",
      },
      data: { value: "3" },
    });
  });

  it("respects an opt-out from overdue reminders only", async () => {
    await updateNotificationPreferences(
      { ...ctx, userId: worker.userId },
      { enabled: [NotificationType.TASK_DUE_SOON] },
    );

    await taskDue("Due tomorrow", new Date(2026, 7, 16));
    await taskDue("Overdue", new Date(2026, 7, 10));

    expect(await notifyDueAndOverdueTasks(ctx, TODAY)).toEqual({
      dueSoon: 1,
      overdue: 0,
    });
  });
});

suite("system notices", () => {
  it("goes to owners and admins by role, not to a named person", async () => {
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    const created = await notifySystem(jobCtx, {
      title: "Monthly generation for 2026-09",
      body: "95 task(s) created.",
    });

    // Olivia is the only Owner or Admin; Wes is an Accountant and Bea a
    // Manager, so neither is in the default audience.
    expect(created).toBe(1);
    expect(await inboxOf(owner.userId, NotificationType.SYSTEM)).toHaveLength(1);
    expect(await inboxOf(worker.userId, NotificationType.SYSTEM)).toHaveLength(
      0,
    );
  });

  it("widens to managers when asked", async () => {
    const jobCtx = systemContext(
      ctx.organizationId,
      ctx.organizationSlug,
      OrgRole.OWNER,
    );

    const created = await notifySystem(
      jobCtx,
      { title: "Wider notice" },
      ["OWNER", "ADMIN", "MANAGER"],
    );

    expect(created).toBe(2);
    expect(await inboxOf(backup.userId, NotificationType.SYSTEM)).toHaveLength(
      1,
    );
  });
});

suite("reading and marking", () => {
  beforeEach(async () => {
    if (!hasDatabase) return;
    await createNotifications(ctx, [
      { memberId: worker.memberId, type: NotificationType.SYSTEM, title: "A" },
      { memberId: worker.memberId, type: NotificationType.MENTION, title: "B" },
      { memberId: backup.memberId, type: NotificationType.SYSTEM, title: "C" },
    ]);
  });

  const asWorker = () => ({ ...ctx, userId: worker.userId });

  it("shows only the signed-in user's own notifications", async () => {
    const result = await listNotifications(asWorker(), {
      unread: false,
      page: 1,
    });

    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.title).sort()).toEqual(["A", "B"]);
    expect(result.unread).toBe(2);
  });

  it("filters to unread and by type", async () => {
    const byType = await listNotifications(asWorker(), {
      unread: false,
      type: NotificationType.MENTION,
      page: 1,
    });
    expect(byType.rows).toHaveLength(1);
    expect(byType.rows[0]?.title).toBe("B");

    // The unread COUNT is deliberately unfiltered — it is the header badge,
    // and a badge that changed with the page's filters would be wrong.
    expect(byType.unread).toBe(2);
  });

  it("marks one read and back to unread", async () => {
    const before = await listNotifications(asWorker(), {
      unread: true,
      page: 1,
    });
    const target = before.rows[0];
    expect(target).toBeDefined();

    await setNotificationRead(asWorker(), target!.id, true);
    expect(await countUnreadNotifications(asWorker())).toBe(1);

    await setNotificationRead(asWorker(), target!.id, false);
    expect(await countUnreadNotifications(asWorker())).toBe(2);
  });

  it("refuses to mark someone else's notification", async () => {
    const theirs = await listNotifications(
      { ...ctx, userId: backup.userId },
      { unread: false, page: 1 },
    );
    const target = theirs.rows[0];
    expect(target).toBeDefined();

    await expect(
      setNotificationRead(asWorker(), target!.id, true),
    ).rejects.toThrow(/not found/i);

    // And it is genuinely untouched, not merely refused.
    expect(
      await countUnreadNotifications({ ...ctx, userId: backup.userId }),
    ).toBe(1);
  });

  it("marks all read without touching anyone else's", async () => {
    const changed = await markAllNotificationsRead(asWorker());

    expect(changed).toBe(2);
    expect(await countUnreadNotifications(asWorker())).toBe(0);
    expect(
      await countUnreadNotifications({ ...ctx, userId: backup.userId }),
    ).toBe(1);
  });
});

suite("preferences", () => {
  const asWorker = () => ({ ...ctx, userId: worker.userId });

  it("defaults every type to enabled with no rows stored", async () => {
    const prefs = await getNotificationPreferences(asWorker());

    for (const type of Object.values(NotificationType)) {
      expect(prefs[type], type).toBe(true);
    }
  });

  it("stores an explicit choice per type", async () => {
    await updateNotificationPreferences(asWorker(), {
      enabled: [NotificationType.MENTION, NotificationType.TASK_ASSIGNED],
    });

    const prefs = await getNotificationPreferences(asWorker());
    expect(prefs[NotificationType.MENTION]).toBe(true);
    expect(prefs[NotificationType.TASK_ASSIGNED]).toBe(true);
    expect(prefs[NotificationType.TASK_OVERDUE]).toBe(false);
    // Never configurable, so it must still read as on.
    expect(prefs[NotificationType.SYSTEM]).toBe(true);
  });

  it("re-enabling works, so a mute is not one-way", async () => {
    await updateNotificationPreferences(asWorker(), { enabled: [] });
    expect(
      (await getNotificationPreferences(asWorker()))[NotificationType.MENTION],
    ).toBe(false);

    await updateNotificationPreferences(asWorker(), {
      enabled: [NotificationType.MENTION],
    });
    expect(
      (await getNotificationPreferences(asWorker()))[NotificationType.MENTION],
    ).toBe(true);
  });

  it("never writes a SYSTEM row", async () => {
    await updateNotificationPreferences(asWorker(), { enabled: [] });

    expect(
      await prisma.notificationPreference.count({
        where: { userId: worker.userId, type: NotificationType.SYSTEM },
      }),
    ).toBe(0);
  });

  it("keeps preferences separate per organization", async () => {
    // The same person can belong to two tenants and want to be noisy in one
    // and quiet in the other, which is why the row is scoped to both.
    await updateNotificationPreferences(asWorker(), { enabled: [] });

    const elsewhere = await getNotificationPreferences({
      ...rivalCtx,
      userId: worker.userId,
    });
    expect(elsewhere[NotificationType.MENTION]).toBe(true);
  });
});
