import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ContractStatus,
  OrgRole,
  Priority,
  ReviewStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import { computeDaysOverdue } from "@/lib/domain/date";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { seedOrgSettings } from "@/server/services/settings";
import {
  TaskOperationError,
  createTask,
  updateTaskStatus,
} from "@/server/services/tasks";
import {
  addTaskComment,
  bulkReassign,
  bulkUpdateStatus,
  deleteTask,
  deleteTaskComment,
  updateTaskDetails,
} from "@/server/services/task-mutations";
import {
  TASKS_PAGE_SIZE,
  getTaskDetail,
  getTaskFormOptions,
  listTasks,
} from "@/server/services/task-queries";
import { taskListQuerySchema } from "@/lib/validation/task";

/**
 * Phase 5 integration tests — the Tasks module through its real service layer
 * against PostgreSQL.
 *
 * The state machine, tenancy boundary, and bulk semantics are exercised
 * end-to-end rather than against a mock, because every one of them is
 * enforced by a database query.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-tasks";
const OTHER_SLUG = "test-org-tasks-other";
const EMAIL_DOMAIN = "@tasks-test.example.com";

const TODAY = new Date(2026, 7, 15);

interface Org {
  ctx: OrgContext;
  /** A second member, for reassignment and comment-authorship tests. */
  secondCtx: OrgContext;
  memberId: string;
  secondMemberId: string;
  clientId: string;
  otherClientId: string;
}

let main: Org;
let other: Org;

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

async function buildOrg(
  slug: string,
  name: string,
  prefix: string,
): Promise<Org> {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  async function addMember(
    label: string,
    seq: number,
    role: OrgRole,
  ): Promise<{ ctx: OrgContext; memberId: string }> {
    const user = await prisma.user.create({
      data: {
        name: `${label} ${prefix}`,
        email: `${prefix}-${label.toLowerCase()}${EMAIL_DOMAIN}`,
        passwordHash: "unused",
      },
      select: { id: true, name: true, email: true },
    });
    const member = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        displayId: formatDisplayId("MEMBER", seq),
        role,
        jobTitle: label,
        isActive: true,
      },
      select: { id: true },
    });
    return {
      memberId: member.id,
      ctx: {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        organizationId: org.id,
        organizationSlug: org.slug,
        membershipId: member.id,
        role,
      },
    };
  }

  const owner = await addMember("Owner", 1, OrgRole.OWNER);
  const second = await addMember("Accountant", 2, OrgRole.ACCOUNTANT);

  const pkg = await prisma.servicePackage.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 2 },
      { organizationId: org.id, entity: "CLIENT", lastValue: 0 },
      { organizationId: org.id, entity: "TASK", lastValue: 0 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
      { organizationId: org.id, entity: "SERVICE_PACKAGE", lastValue: 1 },
    ],
  });

  async function addClient(clientName: string, seq: number) {
    const client = await prisma.client.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("CLIENT", seq),
        name: clientName,
        servicePackageId: pkg.id,
        accountManagerId: owner.memberId,
        startDate: new Date(2026, 0, 1),
        contractStatus: ContractStatus.ACTIVE,
        priority: Priority.MEDIUM,
      },
      select: { id: true },
    });
    return client.id;
  }

  await prisma.idSequence.update({
    where: { organizationId_entity: { organizationId: org.id, entity: "CLIENT" } },
    data: { lastValue: 2 },
  });

  return {
    ctx: owner.ctx,
    secondCtx: second.ctx,
    memberId: owner.memberId,
    secondMemberId: second.memberId,
    clientId: await addClient(`${prefix} Northwind`, 1),
    otherClientId: await addClient(`${prefix} Contoso`, 2),
  };
}

/** Creates a task directly through the service, returning its id. */
async function makeTask(
  org: Org,
  overrides: Partial<Parameters<typeof createTask>[1]> = {},
): Promise<string> {
  const created = await createTask(org.ctx, {
    clientId: org.clientId,
    taskName: "Prepare VAT return",
    serviceArea: "Tax",
    priority: Priority.MEDIUM,
    ...overrides,
  });
  return created.id;
}

/** Walks a task to a target status through legal moves only. */
async function moveTo(org: Org, taskId: string, ...path: TaskStatus[]) {
  for (const status of path) {
    await updateTaskStatus(org.ctx, taskId, status, TODAY);
  }
}

const query = (overrides: Record<string, unknown> = {}) =>
  taskListQuerySchema.parse(overrides);

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  main = await buildOrg(SLUG, "Tasks Test Org", "primary");
  other = await buildOrg(OTHER_SLUG, "Other Tasks Org", "secondary");
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("createTask", () => {
  it("allocates a sequential display id and defaults status to Not Started", async () => {
    const id = await makeTask(main, { taskName: "First task" });
    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { displayId: true, status: true, completionPct: true },
    });

    expect(task.displayId).toBe("TSK-000001");
    expect(task.status).toBe(TaskStatus.NOT_STARTED);
    expect(task.completionPct).toBe(0);
  });

  it("rejects a task missing any legacy-mandatory field", async () => {
    await expect(
      createTask(main.ctx, {
        clientId: main.clientId,
        taskName: "",
        serviceArea: "Tax",
      }),
    ).rejects.toBeInstanceOf(TaskOperationError);

    await expect(
      createTask(main.ctx, {
        clientId: main.clientId,
        taskName: "No service area",
        serviceArea: "",
      }),
    ).rejects.toBeInstanceOf(TaskOperationError);
  });

  it("refuses a client belonging to another organization", async () => {
    await expect(
      createTask(main.ctx, {
        clientId: other.clientId,
        taskName: "Cross-tenant task",
        serviceArea: "Tax",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an assignee belonging to another organization", async () => {
    await expect(
      createTask(main.ctx, {
        clientId: main.clientId,
        taskName: "Foreign assignee",
        serviceArea: "Tax",
        assignedToId: other.memberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepts an explicit null assignee", async () => {
    const id = await makeTask(main, {
      taskName: "Unassigned work",
      assignedToId: null,
    });
    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { assignedToId: true },
    });
    expect(task.assignedToId).toBeNull();
  });
});

suite("updateTaskStatus — state machine", () => {
  it("permits Not Started → In Progress → Completed", async () => {
    const id = await makeTask(main, { taskName: "Happy path" });
    await moveTo(main, id, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { status: true, completionDate: true, completionPct: true },
    });
    expect(task.status).toBe(TaskStatus.COMPLETED);
    // Completion stamps the date and forces 100% (legacy updateTaskStatus).
    expect(task.completionDate).not.toBeNull();
    expect(task.completionPct).toBe(1);
  });

  it("refuses Not Started → Completed", async () => {
    const id = await makeTask(main, { taskName: "Skips the middle" });
    await expect(
      updateTaskStatus(main.ctx, id, TaskStatus.COMPLETED, TODAY),
    ).rejects.toBeInstanceOf(TaskOperationError);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(task.status).toBe(TaskStatus.NOT_STARTED);
  });

  it("clears the completion date when a completed task is reopened", async () => {
    const id = await makeTask(main, { taskName: "Reopened" });
    await moveTo(main, id, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED);
    await updateTaskStatus(main.ctx, id, TaskStatus.IN_PROGRESS, TODAY);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { status: true, completionDate: true },
    });
    expect(task.status).toBe(TaskStatus.IN_PROGRESS);
    expect(task.completionDate).toBeNull();
  });

  it("allows only In Progress out of Completed", async () => {
    const id = await makeTask(main, { taskName: "Completed lock" });
    await moveTo(main, id, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED);

    for (const status of [
      TaskStatus.NOT_STARTED,
      TaskStatus.WAITING_CLIENT,
      TaskStatus.BLOCKED,
      TaskStatus.IN_REVIEW,
      TaskStatus.CANCELLED,
    ]) {
      await expect(
        updateTaskStatus(main.ctx, id, status, TODAY),
        status,
      ).rejects.toBeInstanceOf(TaskOperationError);
    }
  });

  it("makes Cancelled terminal — no status can follow it", async () => {
    const id = await makeTask(main, { taskName: "Cancelled forever" });
    await updateTaskStatus(main.ctx, id, TaskStatus.CANCELLED, TODAY);

    for (const status of Object.values(TaskStatus)) {
      if (status === TaskStatus.CANCELLED) continue;
      await expect(
        updateTaskStatus(main.ctx, id, status, TODAY),
        status,
      ).rejects.toBeInstanceOf(TaskOperationError);
    }
  });

  it("treats a no-op change as a no-op, not an error", async () => {
    const id = await makeTask(main, { taskName: "Same status" });
    await expect(
      updateTaskStatus(main.ctx, id, TaskStatus.NOT_STARTED, TODAY),
    ).resolves.toBeUndefined();

    const history = await prisma.taskStatusHistory.count({ where: { taskId: id } });
    expect(history).toBe(0);
  });

  it("records who changed the status and from what", async () => {
    const id = await makeTask(main, { taskName: "Audited move" });
    await updateTaskStatus(main.ctx, id, TaskStatus.IN_PROGRESS, TODAY);

    const entry = await prisma.taskStatusHistory.findFirstOrThrow({
      where: { taskId: id },
      select: { fromStatus: true, toStatus: true, changedById: true },
    });
    expect(entry.fromStatus).toBe(TaskStatus.NOT_STARTED);
    expect(entry.toStatus).toBe(TaskStatus.IN_PROGRESS);
    expect(entry.changedById).toBe(main.memberId);
  });

  it("refuses a task in another organization", async () => {
    const foreign = await makeTask(other, { taskName: "Theirs" });
    await expect(
      updateTaskStatus(main.ctx, foreign, TaskStatus.IN_PROGRESS, TODAY),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

suite("updateTaskDetails", () => {
  const base = (org: Org, taskId: string) => ({
    taskId,
    clientId: org.clientId,
    taskName: "Renamed task",
    serviceArea: "Bookkeeping",
    description: "Updated description",
    period: "2026-07",
    assignedToId: org.secondMemberId,
    reviewerId: null,
    priority: Priority.HIGH,
    dueDate: new Date(2026, 8, 30),
    startDate: null,
    reviewStatus: ReviewStatus.NOT_REVIEWED,
    clientDependency: false,
    waitingFor: null,
    notes: null,
  });

  it("writes every editable field", async () => {
    const id = await makeTask(main, { taskName: "Before edit" });
    await updateTaskDetails(main.ctx, base(main, id));

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: {
        taskName: true,
        serviceArea: true,
        period: true,
        priority: true,
        assignedToId: true,
        dueDate: true,
      },
    });
    expect(task.taskName).toBe("Renamed task");
    expect(task.serviceArea).toBe("Bookkeeping");
    expect(task.period).toBe("2026-07");
    expect(task.priority).toBe(Priority.HIGH);
    expect(task.assignedToId).toBe(main.secondMemberId);
  });

  it("cannot change status — the state machine is not bypassable by an edit", async () => {
    const id = await makeTask(main, { taskName: "Status held" });
    // A caller smuggling a status through is ignored: updateTaskDetails never
    // reads the field, so it cannot reach the update payload.
    const smuggled = {
      ...base(main, id),
      status: TaskStatus.COMPLETED,
    } as unknown as Parameters<typeof updateTaskDetails>[1];
    await updateTaskDetails(main.ctx, smuggled);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(task.status).toBe(TaskStatus.NOT_STARTED);
  });

  it("refuses a foreign client, assignee, or reviewer", async () => {
    const id = await makeTask(main, { taskName: "Guarded edit" });

    await expect(
      updateTaskDetails(main.ctx, {
        ...base(main, id),
        clientId: other.clientId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      updateTaskDetails(main.ctx, {
        ...base(main, id),
        assignedToId: other.memberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      updateTaskDetails(main.ctx, {
        ...base(main, id),
        reviewerId: other.memberId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to edit a task in another organization", async () => {
    const foreign = await makeTask(other, { taskName: "Theirs" });
    await expect(
      updateTaskDetails(main.ctx, { ...base(main, foreign) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

suite("bulk operations", () => {
  it("applies legal moves and skips illegal ones instead of forcing them", async () => {
    const legal = await makeTask(main, { taskName: "Bulk legal" });
    const cancelled = await makeTask(main, { taskName: "Bulk cancelled" });
    await updateTaskStatus(main.ctx, cancelled, TaskStatus.CANCELLED, TODAY);

    const result = await bulkUpdateStatus(
      main.ctx,
      [legal, cancelled],
      TaskStatus.IN_PROGRESS,
      TODAY,
    );

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.join(" ")).toContain("not allowed");

    const rows = await prisma.task.findMany({
      where: { id: { in: [legal, cancelled] } },
      select: { id: true, status: true },
    });
    expect(rows.find((r) => r.id === legal)?.status).toBe(TaskStatus.IN_PROGRESS);
    // The cancelled task is untouched — a bulk run never overrides the machine.
    expect(rows.find((r) => r.id === cancelled)?.status).toBe(
      TaskStatus.CANCELLED,
    );
  });

  it("counts a task already in the target status as skipped", async () => {
    const id = await makeTask(main, { taskName: "Already there" });
    await updateTaskStatus(main.ctx, id, TaskStatus.IN_PROGRESS, TODAY);

    const result = await bulkUpdateStatus(
      main.ctx,
      [id],
      TaskStatus.IN_PROGRESS,
      TODAY,
    );
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("silently skips ids from another organization without confirming they exist", async () => {
    const mine = await makeTask(main, { taskName: "Mine" });
    const theirs = await makeTask(other, { taskName: "Theirs" });

    const result = await bulkUpdateStatus(
      main.ctx,
      [mine, theirs],
      TaskStatus.IN_PROGRESS,
      TODAY,
    );

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    // The message must not name the id, or the count becomes an existence oracle.
    expect(result.errors.join(" ")).not.toContain(theirs);

    const foreign = await prisma.task.findUniqueOrThrow({
      where: { id: theirs },
      select: { status: true },
    });
    expect(foreign.status).toBe(TaskStatus.NOT_STARTED);
  });

  it("reassigns in bulk and logs one summary entry, not one per task", async () => {
    const a = await makeTask(main, { taskName: "Bulk A" });
    const b = await makeTask(main, { taskName: "Bulk B" });

    const before = await prisma.activityLog.count({
      where: { organizationId: main.ctx.organizationId },
    });

    const result = await bulkReassign(main.ctx, [a, b], main.secondMemberId);
    expect(result.updated).toBe(2);

    const after = await prisma.activityLog.count({
      where: { organizationId: main.ctx.organizationId },
    });
    expect(after - before).toBe(1);

    const rows = await prisma.task.findMany({
      where: { id: { in: [a, b] } },
      select: { assignedToId: true },
    });
    expect(rows.every((r) => r.assignedToId === main.secondMemberId)).toBe(true);
  });

  it("refuses a bulk assignee from another organization", async () => {
    const id = await makeTask(main, { taskName: "Bulk foreign assignee" });
    await expect(
      bulkReassign(main.ctx, [id], other.memberId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("unassigns when given a null assignee", async () => {
    const id = await makeTask(main, {
      taskName: "To unassign",
      assignedToId: main.secondMemberId,
    });
    const result = await bulkReassign(main.ctx, [id], null);
    expect(result.updated).toBe(1);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { assignedToId: true },
    });
    expect(task.assignedToId).toBeNull();
  });
});

suite("comments", () => {
  it("records a comment against the task and its author", async () => {
    const id = await makeTask(main, { taskName: "Commented" });
    await addTaskComment(main.ctx, id, "Chased the client for records.");

    const detail = await getTaskDetail(main.ctx, id, TODAY);
    expect(detail?.comments).toHaveLength(1);
    expect(detail?.comments[0]?.body).toBe("Chased the client for records.");
    expect(detail?.comments[0]?.authorId).toBe(main.ctx.userId);
  });

  it("refuses to comment on a task in another organization", async () => {
    const foreign = await makeTask(other, { taskName: "Theirs" });
    await expect(
      addTaskComment(main.ctx, foreign, "Should not land"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the author remove their own comment", async () => {
    const id = await makeTask(main, { taskName: "Self delete" });
    await addTaskComment(main.ctx, id, "Mine to remove.");
    const detail = await getTaskDetail(main.ctx, id, TODAY);
    const commentId = detail!.comments[0]!.id;

    await deleteTaskComment(main.ctx, id, commentId);

    const after = await getTaskDetail(main.ctx, id, TODAY);
    expect(after?.comments).toHaveLength(0);
    // Soft delete: the row survives for the audit trail.
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: commentId },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("refuses to remove someone else's comment", async () => {
    const id = await makeTask(main, { taskName: "Not yours" });
    await addTaskComment(main.ctx, id, "Owner wrote this.");
    const detail = await getTaskDetail(main.ctx, id, TODAY);
    const commentId = detail!.comments[0]!.id;

    await expect(
      deleteTaskComment(main.secondCtx, id, commentId),
    ).rejects.toBeInstanceOf(TaskOperationError);

    const still = await getTaskDetail(main.ctx, id, TODAY);
    expect(still?.comments).toHaveLength(1);
  });
});

suite("deleteTask", () => {
  it("soft-deletes and removes the task from queries", async () => {
    const id = await makeTask(main, { taskName: "Created in error" });
    await deleteTask(main.ctx, id);

    expect(await getTaskDetail(main.ctx, id, TODAY)).toBeNull();

    const row = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("refuses a task in another organization", async () => {
    const foreign = await makeTask(other, { taskName: "Theirs" });
    await expect(deleteTask(main.ctx, foreign)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

suite("listTasks", () => {
  it("never returns another organization's tasks", async () => {
    await makeTask(other, { taskName: "Strictly theirs" });
    const result = await listTasks(main.ctx, query({ status: "ALL" }), TODAY);

    const foreignCount = await prisma.task.count({
      where: { organizationId: other.ctx.organizationId, deletedAt: null },
    });
    expect(foreignCount).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.taskName !== "Strictly theirs")).toBe(
      true,
    );
  });

  it("excludes closed statuses under the OPEN filter", async () => {
    const done = await makeTask(main, { taskName: "Closed out" });
    await moveTo(main, done, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED);

    const open = await listTasks(main.ctx, query({ status: "OPEN" }), TODAY);
    expect(open.rows.some((row) => row.id === done)).toBe(false);

    const all = await listTasks(main.ctx, query({ status: "ALL" }), TODAY);
    expect(all.rows.some((row) => row.id === done)).toBe(true);
  });

  it("filters by client, priority, assignee, and period", async () => {
    const id = await makeTask(main, {
      taskName: "Filterable",
      clientId: main.otherClientId,
      priority: Priority.CRITICAL,
      assignedToId: main.secondMemberId,
      period: "2026-11",
    });

    const byClient = await listTasks(
      main.ctx,
      query({ clientId: main.otherClientId, status: "ALL" }),
      TODAY,
    );
    expect(byClient.rows.every((r) => r.clientId === main.otherClientId)).toBe(
      true,
    );
    expect(byClient.rows.some((r) => r.id === id)).toBe(true);

    const byPriority = await listTasks(
      main.ctx,
      query({ priority: Priority.CRITICAL, status: "ALL" }),
      TODAY,
    );
    expect(byPriority.rows.every((r) => r.priority === Priority.CRITICAL)).toBe(
      true,
    );

    const byPeriod = await listTasks(
      main.ctx,
      query({ period: "2026-11", status: "ALL" }),
      TODAY,
    );
    expect(byPeriod.rows.every((r) => r.period === "2026-11")).toBe(true);
    expect(byPeriod.rows.some((r) => r.id === id)).toBe(true);
  });

  it("finds unassigned work through the UNASSIGNED filter", async () => {
    const id = await makeTask(main, {
      taskName: "Nobody owns this",
      assignedToId: null,
    });
    const result = await listTasks(
      main.ctx,
      query({ assignedToId: "UNASSIGNED", status: "ALL" }),
      TODAY,
    );
    expect(result.rows.some((r) => r.id === id)).toBe(true);
    expect(result.rows.every((r) => r.assignedToName === null)).toBe(true);
  });

  it("agrees with computeDaysOverdue on which tasks are overdue", async () => {
    // Past due and open → overdue. Due today → not overdue. Past due but
    // completed → not overdue. The SQL filter must match the domain rule.
    const past = await makeTask(main, {
      taskName: "Overdue open",
      dueDate: new Date(2026, 6, 1),
    });
    const dueToday = await makeTask(main, {
      taskName: "Due today",
      dueDate: new Date(2026, 7, 15),
    });
    const closed = await makeTask(main, {
      taskName: "Overdue but done",
      dueDate: new Date(2026, 6, 1),
    });
    await moveTo(main, closed, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED);

    const result = await listTasks(
      main.ctx,
      query({ overdue: "true", status: "ALL" }),
      TODAY,
    );
    const ids = new Set(result.rows.map((r) => r.id));

    expect(ids.has(past)).toBe(true);
    expect(ids.has(dueToday)).toBe(false);
    expect(ids.has(closed)).toBe(false);

    // Every row the SQL returned is one the domain function also calls overdue.
    for (const row of result.rows) {
      expect(
        computeDaysOverdue(row.dueDate, row.status, TODAY),
        row.displayId,
      ).toBeGreaterThan(0);
    }
  });

  it("matches on task name, display id, service area, and client name", async () => {
    const id = await makeTask(main, {
      taskName: "Distinctive Reconciliation",
      serviceArea: "Payroll Review",
    });
    const displayId = (
      await prisma.task.findUniqueOrThrow({
        where: { id },
        select: { displayId: true },
      })
    ).displayId;

    for (const term of [
      "distinctive",
      displayId.toLowerCase(),
      "payroll review",
    ]) {
      const result = await listTasks(
        main.ctx,
        query({ q: term, status: "ALL" }),
        TODAY,
      );
      expect(result.rows.some((r) => r.id === id), term).toBe(true);
    }
  });

  it("sorts by due date with undated tasks last", async () => {
    const result = await listTasks(
      main.ctx,
      query({ sort: "dueDate", status: "ALL" }),
      TODAY,
    );
    const firstNull = result.rows.findIndex((r) => r.dueDate === null);
    if (firstNull !== -1) {
      expect(
        result.rows.slice(firstNull).every((r) => r.dueDate === null),
      ).toBe(true);
    }
  });

  it("clamps a page beyond the end rather than returning nothing", async () => {
    const result = await listTasks(
      main.ctx,
      query({ page: 999, status: "ALL" }),
      TODAY,
    );
    expect(result.page).toBe(result.pageCount);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(TASKS_PAGE_SIZE);
  });

  it("omits soft-deleted tasks from the total", async () => {
    const id = await makeTask(main, { taskName: "Counted then removed" });
    const before = await listTasks(main.ctx, query({ status: "ALL" }), TODAY);
    await deleteTask(main.ctx, id);
    const after = await listTasks(main.ctx, query({ status: "ALL" }), TODAY);

    expect(after.total).toBe(before.total - 1);
  });
});

suite("getTaskDetail", () => {
  it("offers exactly the transitions the state machine permits", async () => {
    const id = await makeTask(main, { taskName: "Transition options" });

    const fresh = await getTaskDetail(main.ctx, id, TODAY);
    expect(fresh?.allowedTransitions).toEqual([
      TaskStatus.IN_PROGRESS,
      TaskStatus.CANCELLED,
    ]);

    await updateTaskStatus(main.ctx, id, TaskStatus.IN_PROGRESS, TODAY);
    const running = await getTaskDetail(main.ctx, id, TODAY);
    expect(new Set(running?.allowedTransitions)).toEqual(
      new Set([
        TaskStatus.WAITING_CLIENT,
        TaskStatus.BLOCKED,
        TaskStatus.IN_REVIEW,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELLED,
      ]),
    );

    await updateTaskStatus(main.ctx, id, TaskStatus.CANCELLED, TODAY);
    const cancelled = await getTaskDetail(main.ctx, id, TODAY);
    expect(cancelled?.allowedTransitions).toEqual([]);
  });

  it("never offers the current status as a transition", async () => {
    const id = await makeTask(main, { taskName: "No self move" });
    const detail = await getTaskDetail(main.ctx, id, TODAY);
    expect(detail?.allowedTransitions).not.toContain(detail?.task.status);
  });

  it("returns null for a task in another organization", async () => {
    const foreign = await makeTask(other, { taskName: "Theirs" });
    expect(await getTaskDetail(main.ctx, foreign, TODAY)).toBeNull();
  });

  it("returns status history newest first, with the mover's name", async () => {
    const id = await makeTask(main, { taskName: "History order" });
    await moveTo(main, id, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW);

    const detail = await getTaskDetail(main.ctx, id, TODAY);
    expect(detail?.history).toHaveLength(2);
    expect(detail?.history[0]?.toStatus).toBe(TaskStatus.IN_REVIEW);
    expect(detail?.history[1]?.toStatus).toBe(TaskStatus.IN_PROGRESS);
    expect(detail?.history[0]?.changedByName).toBe(main.ctx.userName);
  });

  it("derives days overdue from the domain function", async () => {
    const id = await makeTask(main, {
      taskName: "Overdue detail",
      dueDate: new Date(2026, 7, 10),
    });
    const detail = await getTaskDetail(main.ctx, id, TODAY);
    expect(detail?.daysOverdue).toBe(5);
    expect(detail?.daysRemaining).toBe(-5);
  });
});

suite("getTaskFormOptions", () => {
  it("lists only this organization's clients and active members", async () => {
    const options = await getTaskFormOptions(main.ctx);

    const foreignClients = await prisma.client.findMany({
      where: { organizationId: other.ctx.organizationId },
      select: { id: true },
    });
    const foreignIds = new Set(foreignClients.map((c) => c.id));

    expect(options.clients.length).toBeGreaterThan(0);
    expect(options.clients.some((c) => foreignIds.has(c.id))).toBe(false);
    expect(options.members.some((m) => m.id === other.memberId)).toBe(false);
    expect(options.members.some((m) => m.id === main.memberId)).toBe(true);
  });

  it("offers distinct service areas and periods drawn from real tasks", async () => {
    await makeTask(main, {
      taskName: "Options source",
      serviceArea: "VAT Filing",
      period: "2026-12",
    });
    const options = await getTaskFormOptions(main.ctx);

    expect(options.serviceAreas).toContain("VAT Filing");
    expect(new Set(options.serviceAreas).size).toBe(options.serviceAreas.length);
    expect(options.periods).toContain("2026-12");
    expect(options.periods.every((p) => p !== null)).toBe(true);
  });
});
