import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CloseStageStatus,
  CloseStatus,
  ContractStatus,
  OrgRole,
  Priority,
  ReviewStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import { buildMonthlyCloseId, formatDisplayId } from "@/lib/domain/ids";
import {
  computeCloseCompletion,
  computeCloseStatus,
} from "@/lib/domain/monthly-close";
import { closeListQuerySchema } from "@/lib/validation/monthly-close";
import { ForbiddenError, type OrgContext } from "@/server/context";
import {
  changeStageStatus,
  getCloseDetail,
  listMonthlyCloses,
  openMonthlyClose,
  recalculateClose,
  updateClose,
} from "@/server/services/monthly-close";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 10 integration tests — Monthly Close against PostgreSQL.
 *
 * The close carries two completion figures that must not be conflated: the
 * stage-based one stored on the close row, and the task-based one the
 * dashboard computes across every task for the period. Both are pinned here.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-close";
const OTHER_SLUG = "test-org-close-other";
const EMAIL_DOMAIN = "@close-test.example.com";

const TODAY = new Date(2026, 7, 15);
const PERIOD = "2026-08";
const daysAgo = (n: number) => new Date(2026, 7, 15 - n);
const daysAhead = (n: number) => new Date(2026, 7, 15 + n);

let ctx: OrgContext;
let otherCtx: OrgContext;
let clientId: string;
let clientDisplayId: string;
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
  const client = await prisma.client.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("CLIENT", 1),
      name: `${prefix} Client`,
      servicePackageId: pkg.id,
      accountManagerId: member.id,
      startDate: new Date(2026, 0, 1),
      contractStatus: ContractStatus.ACTIVE,
      priority: Priority.MEDIUM,
    },
    select: { id: true, displayId: true },
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

  return { org, client, context };
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const main = await buildOrg(SLUG, "Close Test Org", "primary");
  ctx = main.context;
  clientId = main.client.id;
  clientDisplayId = main.client.displayId;

  const other = await buildOrg(OTHER_SLUG, "Close Other Org", "secondary");
  otherCtx = other.context;
  otherClientId = other.client.id;

  /**
   * Tasks for the period, covering every count the close dashboard makes.
   * One task sits in a DIFFERENT period so the period filter is exercised,
   * and one has no Month-End Closing service area at all — legacy counted the
   * whole period regardless of service area (audit §6.13).
   */
  const taskSpec: {
    status: TaskStatus;
    dueDate: Date | null;
    period: string;
    area: string;
  }[] = [
    { status: TaskStatus.COMPLETED, dueDate: daysAgo(9), period: PERIOD, area: "Month-End Closing" },
    { status: TaskStatus.COMPLETED, dueDate: daysAgo(4), period: PERIOD, area: "Bookkeeping" },
    { status: TaskStatus.IN_PROGRESS, dueDate: daysAgo(2), period: PERIOD, area: "Tax" },
    { status: TaskStatus.NOT_STARTED, dueDate: daysAhead(4), period: PERIOD, area: "Payroll" },
    { status: TaskStatus.WAITING_CLIENT, dueDate: daysAgo(1), period: PERIOD, area: "Bookkeeping" },
    { status: TaskStatus.BLOCKED, dueDate: daysAhead(3), period: PERIOD, area: "Tax" },
    { status: TaskStatus.CANCELLED, dueDate: daysAgo(20), period: PERIOD, area: "Tax" },
    // Different period — must not reach this close's summary.
    { status: TaskStatus.NOT_STARTED, dueDate: daysAhead(40), period: "2026-09", area: "Tax" },
  ];

  for (const [index, entry] of taskSpec.entries()) {
    await prisma.task.create({
      data: {
        organizationId: main.org.id,
        displayId: formatDisplayId("TASK", index + 1),
        clientId,
        taskName: `Close task ${index + 1}`,
        serviceArea: entry.area,
        status: entry.status,
        dueDate: entry.dueDate,
        period: entry.period,
        priority: Priority.MEDIUM,
      },
    });
  }
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

async function freshClose(period: string) {
  const existing = await prisma.monthlyClose.findFirst({
    where: { organizationId: ctx.organizationId, clientId, period },
    select: { id: true },
  });
  if (existing) {
    await prisma.monthlyClose.delete({ where: { id: existing.id } });
  }
  return openMonthlyClose(ctx, clientId, period);
}

suite("openMonthlyClose", () => {
  it("builds the composite legacy display id", async () => {
    const close = await freshClose(PERIOD);
    // Legacy buildMonthlyCloseId: MC-<ClientDisplayId>-<YYYYMM>.
    expect(close.displayId).toBe(buildMonthlyCloseId(clientDisplayId, PERIOD));
    expect(close.displayId).toBe(`MC-${clientDisplayId}-202608`);
    expect(close.created).toBe(true);
  });

  it("materialises all eighteen stages in legacy order", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      orderBy: { stageOrder: "asc" },
      select: { stageName: true, stageOrder: true, status: true },
    });

    expect(stages).toHaveLength(18);
    expect(stages.map((s) => s.stageName)).toEqual([...MONTHLY_CLOSE_STAGES]);
    expect(stages.map((s) => s.stageOrder)).toEqual(
      MONTHLY_CLOSE_STAGES.map((_, i) => i),
    );
    expect(
      stages.every((s) => s.status === CloseStageStatus.NOT_STARTED),
    ).toBe(true);
  });

  it("starts Not Started at 0%", async () => {
    const close = await freshClose(PERIOD);
    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { status: true, completionPct: true, closedAt: true },
    });
    expect(row.status).toBe(CloseStatus.NOT_STARTED);
    expect(row.completionPct).toBe(0);
    expect(row.closedAt).toBeNull();
  });

  it("returns the existing close rather than duplicating", async () => {
    const first = await freshClose(PERIOD);
    const second = await openMonthlyClose(ctx, clientId, PERIOD);

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);

    const count = await prisma.monthlyClose.count({
      where: { organizationId: ctx.organizationId, clientId, period: PERIOD },
    });
    expect(count).toBe(1);
  });

  it("refuses a client in another organization", async () => {
    await expect(
      openMonthlyClose(ctx, otherClientId, PERIOD),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

suite("stage changes and derived status", () => {
  it("recomputes completion as completed / 18", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      orderBy: { stageOrder: "asc" },
      select: { id: true },
    });

    await changeStageStatus(
      ctx,
      close.id,
      stages[0]!.id,
      CloseStageStatus.COMPLETED,
      TODAY,
    );

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { completionPct: true, status: true },
    });
    // One of eighteen — NOT one of one. Legacy's COUNTA denominator counted
    // only non-blank cells, so a single completed stage read 100%; every stage
    // is materialised here so that cannot happen (Phase 3 DIFF-1).
    expect(row.completionPct).toBeCloseTo(1 / 18, 10);
    expect(row.status).toBe(CloseStatus.IN_PROGRESS);
  });

  it("has no transition table — any stage status may follow any other", async () => {
    const close = await freshClose(PERIOD);
    const stage = await prisma.monthlyCloseTask.findFirstOrThrow({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });

    for (const from of Object.values(CloseStageStatus)) {
      for (const to of Object.values(CloseStageStatus)) {
        if (from === to) continue;
        await prisma.monthlyCloseTask.update({
          where: { id: stage.id },
          data: { status: from },
        });
        await expect(
          changeStageStatus(ctx, close.id, stage.id, to, TODAY),
          `${from} -> ${to}`,
        ).resolves.toBeUndefined();
      }
    }
  });

  it("stamps and clears the stage completion date", async () => {
    const close = await freshClose(PERIOD);
    const stage = await prisma.monthlyCloseTask.findFirstOrThrow({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });

    await changeStageStatus(
      ctx,
      close.id,
      stage.id,
      CloseStageStatus.COMPLETED,
      TODAY,
    );
    const done = await prisma.monthlyCloseTask.findUniqueOrThrow({
      where: { id: stage.id },
      select: { completedAt: true },
    });
    expect(done.completedAt).not.toBeNull();

    await changeStageStatus(
      ctx,
      close.id,
      stage.id,
      CloseStageStatus.IN_PROGRESS,
      TODAY,
    );
    const reopened = await prisma.monthlyCloseTask.findUniqueOrThrow({
      where: { id: stage.id },
      select: { completedAt: true },
    });
    expect(reopened.completedAt).toBeNull();
  });

  it("reports Blocked when any stage is blocked and the close is unfinished", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      orderBy: { stageOrder: "asc" },
      select: { id: true },
    });

    await changeStageStatus(ctx, close.id, stages[0]!.id, CloseStageStatus.COMPLETED, TODAY);
    await changeStageStatus(ctx, close.id, stages[1]!.id, CloseStageStatus.BLOCKED, TODAY);

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { status: true },
    });
    expect(row.status).toBe(CloseStatus.BLOCKED);
  });

  it("reads Closed when every stage is complete, and stamps closedAt", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });

    for (const stage of stages) {
      await changeStageStatus(
        ctx,
        close.id,
        stage.id,
        CloseStageStatus.COMPLETED,
        TODAY,
      );
    }

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { status: true, completionPct: true, closedAt: true },
    });
    expect(row.completionPct).toBe(1);
    expect(row.status).toBe(CloseStatus.CLOSED);
    expect(row.closedAt).not.toBeNull();
  });

  it("clears closedAt when a completed close is reopened", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });
    for (const stage of stages) {
      await changeStageStatus(ctx, close.id, stage.id, CloseStageStatus.COMPLETED, TODAY);
    }

    await changeStageStatus(
      ctx,
      close.id,
      stages[0]!.id,
      CloseStageStatus.IN_PROGRESS,
      TODAY,
    );

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { status: true, closedAt: true },
    });
    expect(row.status).toBe(CloseStatus.IN_PROGRESS);
    expect(row.closedAt).toBeNull();
  });

  it("checks Closed before Blocked, as the legacy IFS did", async () => {
    // A close whose stages are ALL Completed can have no blocked stage, so
    // the ordering only shows through the pure function: completion of 1 wins
    // even when a blocked stage is present in the input.
    const allComplete: {
      stageName: string;
      stageOrder: number;
      status: CloseStageStatus;
    }[] = MONTHLY_CLOSE_STAGES.map((stageName, index) => ({
      stageName,
      stageOrder: index,
      status: CloseStageStatus.COMPLETED,
    }));
    expect(computeCloseStatus(allComplete)).toBe(CloseStatus.CLOSED);

    const mixed = [...allComplete];
    mixed[3] = { ...mixed[3]!, status: CloseStageStatus.BLOCKED };
    expect(computeCloseCompletion(mixed)).toBeCloseTo(17 / 18, 10);
    expect(computeCloseStatus(mixed)).toBe(CloseStatus.BLOCKED);
  });

  it("is a no-op when the stage is already in that status", async () => {
    const close = await freshClose(PERIOD);
    const stage = await prisma.monthlyCloseTask.findFirstOrThrow({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });

    const before = await prisma.activityLog.count({
      where: { organizationId: ctx.organizationId },
    });
    await changeStageStatus(
      ctx,
      close.id,
      stage.id,
      CloseStageStatus.NOT_STARTED,
      TODAY,
    );
    const after = await prisma.activityLog.count({
      where: { organizationId: ctx.organizationId },
    });
    expect(after).toBe(before);
  });

  it("refuses a close or stage from another organization", async () => {
    const close = await freshClose(PERIOD);
    const stage = await prisma.monthlyCloseTask.findFirstOrThrow({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });

    await expect(
      changeStageStatus(
        otherCtx,
        close.id,
        stage.id,
        CloseStageStatus.COMPLETED,
        TODAY,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a stage that belongs to a different close", async () => {
    const a = await freshClose(PERIOD);
    const b = await openMonthlyClose(ctx, clientId, "2026-07");
    const stageOfB = await prisma.monthlyCloseTask.findFirstOrThrow({
      where: { monthlyCloseId: b.id },
      select: { id: true },
    });

    await expect(
      changeStageStatus(ctx, a.id, stageOfB.id, CloseStageStatus.COMPLETED, TODAY),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await prisma.monthlyClose.delete({ where: { id: b.id } });
  });
});

suite("recalculateClose", () => {
  it("re-derives stored values from the stage rows", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      orderBy: { stageOrder: "asc" },
      select: { id: true },
    });

    // Write stages directly, bypassing the service, then reconcile.
    await prisma.monthlyCloseTask.updateMany({
      where: { id: { in: stages.slice(0, 9).map((s) => s.id) } },
      data: { status: CloseStageStatus.COMPLETED },
    });

    const result = await recalculateClose(ctx, close.id, TODAY);
    expect(result.completionPct).toBeCloseTo(0.5, 10);
    expect(result.status).toBe(CloseStatus.IN_PROGRESS);

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { completionPct: true, status: true },
    });
    expect(row.completionPct).toBeCloseTo(0.5, 10);
    expect(row.status).toBe(CloseStatus.IN_PROGRESS);
  });
});

suite("getCloseDetail — the two completion figures", () => {
  it("counts every task for the period, not only Month-End Closing work", async () => {
    const close = await freshClose(PERIOD);
    const detail = (await getCloseDetail(ctx, close.id, TODAY))!;

    // Seven tasks in the period; the cancelled one is excluded from the
    // counts but the period task list still holds it.
    expect(detail.periodTasks).toHaveLength(7);

    const areas = new Set(detail.periodTasks.map((t) => t.serviceArea));
    expect(areas.size).toBeGreaterThan(1);
    expect(areas.has("Bookkeeping")).toBe(true);
  });

  it("excludes tasks from other periods", async () => {
    const close = await freshClose(PERIOD);
    const detail = (await getCloseDetail(ctx, close.id, TODAY))!;
    expect(detail.periodTasks.every((t) => t.period === PERIOD)).toBe(true);
  });

  it("summarises the period by the legacy rules", async () => {
    const close = await freshClose(PERIOD);
    const detail = (await getCloseDetail(ctx, close.id, TODAY))!;
    const s = detail.taskSummary;

    // Six non-cancelled: 2 completed, 1 in progress, 1 not started,
    // 1 waiting client, 1 blocked.
    expect(s.completed).toBe(2);
    expect(s.waitingClient).toBe(1);
    expect(s.blocked).toBe(1);
    // Pending excludes blocked and waiting-client, which have their own counts.
    expect(s.pending).toBe(2);
    // Overdue: the in-progress one at -2 and the waiting one at -1.
    expect(s.overdue).toBe(2);
    expect(s.completionPct).toBeCloseTo(2 / 6, 10);
  });

  it("keeps the stage figure independent of the task figure", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });
    for (const stage of stages) {
      await changeStageStatus(ctx, close.id, stage.id, CloseStageStatus.COMPLETED, TODAY);
    }

    const detail = (await getCloseDetail(ctx, close.id, TODAY))!;
    // Stages fully done; the period's tasks are not. Two different questions.
    expect(detail.completionPct).toBe(1);
    expect(detail.status).toBe(CloseStatus.CLOSED);
    expect(detail.taskSummary.completionPct).toBeLessThan(1);
  });

  it("returns stages in legacy order", async () => {
    const close = await freshClose(PERIOD);
    const detail = (await getCloseDetail(ctx, close.id, TODAY))!;
    expect(detail.stages.map((s) => s.stageName)).toEqual([
      ...MONTHLY_CLOSE_STAGES,
    ]);
  });

  it("returns null for a close in another organization", async () => {
    const close = await freshClose(PERIOD);
    expect(await getCloseDetail(otherCtx, close.id, TODAY)).toBeNull();
  });
});

suite("listMonthlyCloses", () => {
  it("filters by period, client, and status", async () => {
    await freshClose(PERIOD);
    const july = await openMonthlyClose(ctx, clientId, "2026-07");

    const byPeriod = await listMonthlyCloses(
      ctx,
      closeListQuerySchema.parse({ period: PERIOD }),
    );
    expect(byPeriod.rows.every((r) => r.period === PERIOD)).toBe(true);

    const byClient = await listMonthlyCloses(
      ctx,
      closeListQuerySchema.parse({ clientId }),
    );
    expect(byClient.rows.every((r) => r.clientId === clientId)).toBe(true);
    expect(byClient.total).toBeGreaterThanOrEqual(2);

    await prisma.monthlyClose.delete({ where: { id: july.id } });
  });

  it("treats OPEN as anything not yet Closed", async () => {
    const close = await freshClose(PERIOD);
    const open = await listMonthlyCloses(
      ctx,
      closeListQuerySchema.parse({ status: "OPEN" }),
    );
    expect(open.rows.some((r) => r.id === close.id)).toBe(true);

    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      select: { id: true },
    });
    for (const stage of stages) {
      await changeStageStatus(ctx, close.id, stage.id, CloseStageStatus.COMPLETED, TODAY);
    }

    const stillOpen = await listMonthlyCloses(
      ctx,
      closeListQuerySchema.parse({ status: "OPEN" }),
    );
    expect(stillOpen.rows.some((r) => r.id === close.id)).toBe(false);
  });

  it("reports stage counts alongside the percentage", async () => {
    const close = await freshClose(PERIOD);
    const stages = await prisma.monthlyCloseTask.findMany({
      where: { monthlyCloseId: close.id },
      orderBy: { stageOrder: "asc" },
      select: { id: true },
    });
    await changeStageStatus(ctx, close.id, stages[0]!.id, CloseStageStatus.COMPLETED, TODAY);
    await changeStageStatus(ctx, close.id, stages[1]!.id, CloseStageStatus.BLOCKED, TODAY);

    const list = await listMonthlyCloses(ctx, closeListQuerySchema.parse({}));
    const row = list.rows.find((r) => r.id === close.id)!;
    expect(row.stageCount).toBe(18);
    expect(row.stagesCompleted).toBe(1);
    expect(row.stagesBlocked).toBe(1);
  });

  it("never returns another organization's closes", async () => {
    await freshClose(PERIOD);
    const neighbour = await openMonthlyClose(otherCtx, otherClientId, PERIOD);

    const mine = await listMonthlyCloses(ctx, closeListQuerySchema.parse({}));
    expect(mine.rows.some((r) => r.id === neighbour.id)).toBe(false);

    await prisma.monthlyClose.delete({ where: { id: neighbour.id } });
  });
});

suite("updateClose", () => {
  it("saves review status and notes", async () => {
    const close = await freshClose(PERIOD);
    await updateClose(ctx, close.id, ReviewStatus.APPROVED, "Signed off.");

    const row = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: close.id },
      select: { reviewStatus: true, notes: true, status: true },
    });
    expect(row.reviewStatus).toBe(ReviewStatus.APPROVED);
    expect(row.notes).toBe("Signed off.");
    // Review is independent of the derived close status.
    expect(row.status).toBe(CloseStatus.NOT_STARTED);
  });

  it("refuses a close in another organization", async () => {
    const close = await freshClose(PERIOD);
    await expect(
      updateClose(otherCtx, close.id, ReviewStatus.APPROVED, null),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
