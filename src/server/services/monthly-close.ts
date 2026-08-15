import type { Prisma } from "@/generated/prisma/client";
import {
  CloseStageStatus,
  CloseStatus,
  EntityType,
  ReviewStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import { buildMonthlyCloseId } from "@/lib/domain/ids";
import {
  buildCloseStages,
  computeCloseCompletion,
  computeCloseStatus,
} from "@/lib/domain/monthly-close";
import type { DomainCloseStage, DomainTask } from "@/lib/domain/types";
import {
  buildMonthlyCloseSummary,
  orderStages,
  type MonthlyCloseSummary,
} from "@/lib/domain/view-models/monthly-close-dashboard";
import type { CloseListQuery } from "@/lib/validation/monthly-close";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { taskSelect, toDomainTask } from "@/server/services/mappers";

/**
 * Monthly close service.
 *
 * Port of legacy's MONTHLY_CLOSE sheet plus
 * `dashboards/MonthlyCloseDashboardEngine.gs` (audit §6.13, §8).
 *
 * Two numbers on this screen are deliberately different and must not be
 * conflated:
 *
 *  - **Stage completion** — `COUNTIF(stages,"Completed") / COUNTA(stages)`
 *    over the 18 close stages. Stored on the close row, as legacy stored it.
 *  - **Task completion** — over every task for that client and period, which
 *    legacy's dashboard counted regardless of service area, because "the
 *    close" spans every deliverable due that period.
 *
 * Neither is accepted as input: both are derived, and the stored one is
 * recomputed on every stage change so it cannot drift.
 */

export class CloseOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloseOperationError";
  }
}

export const CLOSES_PAGE_SIZE = 50;

const closeSelect = {
  id: true,
  displayId: true,
  clientId: true,
  period: true,
  status: true,
  completionPct: true,
  reviewStatus: true,
  notes: true,
  closedAt: true,
  client: { select: { name: true, displayId: true } },
  stages: {
    select: {
      id: true,
      stageName: true,
      stageOrder: true,
      status: true,
      completedAt: true,
      notes: true,
    },
  },
} satisfies Prisma.MonthlyCloseSelect;

type CloseRow = Prisma.MonthlyCloseGetPayload<{ select: typeof closeSelect }>;

export interface CloseStageRow {
  id: string;
  stageName: string;
  stageOrder: number;
  status: CloseStageStatus;
  completedAt: Date | null;
  notes: string | null;
}

export interface CloseListRow {
  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  period: string;
  status: CloseStatus;
  completionPct: number;
  reviewStatus: ReviewStatus;
  closedAt: Date | null;
  stagesCompleted: number;
  stagesBlocked: number;
  stageCount: number;
}

export interface CloseListResult {
  rows: CloseListRow[];
  total: number;
  page: number;
  pageCount: number;
}

export interface CloseDetail {
  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  clientDisplayId: string;
  period: string;
  /** Stage-based, from the 18 close stages. */
  status: CloseStatus;
  completionPct: number;
  reviewStatus: ReviewStatus;
  notes: string | null;
  closedAt: Date | null;
  stages: CloseStageRow[];
  /** Task-based, across every task for the period (audit §6.13). */
  taskSummary: MonthlyCloseSummary;
  periodTasks: DomainTask[];
}

/** The stage rows as the domain functions want them. */
function toDomainStages(row: CloseRow): DomainCloseStage[] {
  return row.stages.map((stage) => ({
    stageName: stage.stageName,
    stageOrder: stage.stageOrder,
    status: stage.status,
  }));
}

function toListRow(row: CloseRow): CloseListRow {
  return {
    id: row.id,
    displayId: row.displayId,
    clientId: row.clientId,
    clientName: row.client.name,
    period: row.period,
    status: row.status,
    completionPct: row.completionPct,
    reviewStatus: row.reviewStatus,
    closedAt: row.closedAt,
    stagesCompleted: row.stages.filter(
      (s) => s.status === CloseStageStatus.COMPLETED,
    ).length,
    stagesBlocked: row.stages.filter(
      (s) => s.status === CloseStageStatus.BLOCKED,
    ).length,
    stageCount: row.stages.length,
  };
}

/**
 * Opens a close for a client and period.
 *
 * All eighteen stages are materialised up front. Legacy left untouched stage
 * cells blank, and its `COUNTA` denominator counted only non-blank ones — so a
 * close with a single Completed stage read 100% and "Closed". Materialising
 * every stage with an explicit Not Started keeps the denominator at 18 and
 * makes that impossible (Phase 3 DIFF-1). The ported `computeCloseCompletion`
 * still honours blanks, so imported legacy rows behave as they did.
 *
 * Re-opening an existing close returns it rather than failing: the period is
 * unique per client, and legacy's sheet had one row per client+month.
 */
export async function openMonthlyClose(
  ctx: OrgContext,
  clientId: string,
  period: string,
): Promise<{ id: string; displayId: string; created: boolean }> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, displayId: true, name: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }

  const existing = await prisma.monthlyClose.findFirst({
    where: {
      organizationId: ctx.organizationId,
      clientId,
      period,
      deletedAt: null,
    },
    select: { id: true, displayId: true },
  });
  if (existing) return { ...existing, created: false };

  const stages = buildCloseStages(MONTHLY_CLOSE_STAGES);
  const displayId = buildMonthlyCloseId(client.displayId, period);

  const close = await prisma.monthlyClose.create({
    data: {
      organizationId: ctx.organizationId,
      displayId,
      clientId,
      period,
      // Derived from the freshly built stages rather than assumed: all
      // eighteen are Not Started, so both come out at the bottom.
      status: computeCloseStatus(stages),
      completionPct: computeCloseCompletion(stages),
      stages: {
        create: stages.map((stage) => ({
          stageName: stage.stageName,
          stageOrder: stage.stageOrder,
          status: stage.status as CloseStageStatus,
        })),
      },
    },
    select: { id: true, displayId: true },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.CLOSE_OPENED,
    entityType: EntityType.MONTHLY_CLOSE,
    entityId: close.id,
    clientId,
    newValue: `${client.name} — ${period}`,
  });

  return { ...close, created: true };
}

export async function listMonthlyCloses(
  ctx: OrgContext,
  query: CloseListQuery,
): Promise<CloseListResult> {
  const where: Prisma.MonthlyCloseWhereInput = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };

  if (query.clientId && query.clientId !== "ALL") {
    where.clientId = query.clientId;
  }
  if (query.period && query.period !== "ALL") {
    where.period = query.period;
  }
  if (query.status && query.status !== "ALL") {
    // "OPEN" means anything not yet Closed — the useful default view.
    where.status =
      query.status === "OPEN"
        ? { not: CloseStatus.CLOSED }
        : (query.status as CloseStatus);
  }

  const total = await prisma.monthlyClose.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CLOSES_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const rows = await prisma.monthlyClose.findMany({
    where,
    select: closeSelect,
    // Newest period first, then by client — the order a partner reviews them.
    orderBy: [{ period: "desc" }, { client: { name: "asc" } }],
    skip: (page - 1) * CLOSES_PAGE_SIZE,
    take: CLOSES_PAGE_SIZE,
  });

  return { rows: rows.map(toListRow), total, page, pageCount };
}

export async function getCloseDetail(
  ctx: OrgContext,
  closeId: string,
  today: Date = new Date(),
): Promise<CloseDetail | null> {
  const row = await prisma.monthlyClose.findFirst({
    where: { id: closeId, organizationId: ctx.organizationId, deletedAt: null },
    select: closeSelect,
  });
  if (!row) return null;

  // Every task for that client in that period — NOT only the ones tagged with
  // the Month-End Closing service area (audit §6.13).
  const taskRows = await prisma.task.findMany({
    where: {
      organizationId: ctx.organizationId,
      clientId: row.clientId,
      period: row.period,
      deletedAt: null,
    },
    select: taskSelect,
  });
  const periodTasks = taskRows.map(toDomainTask);

  return {
    id: row.id,
    displayId: row.displayId,
    clientId: row.clientId,
    clientName: row.client.name,
    clientDisplayId: row.client.displayId,
    period: row.period,
    status: row.status,
    completionPct: row.completionPct,
    reviewStatus: row.reviewStatus,
    notes: row.notes,
    closedAt: row.closedAt,
    stages: orderStages(toDomainStages(row)).map((stage) => {
      const stored = row.stages.find((s) => s.stageName === stage.stageName)!;
      return {
        id: stored.id,
        stageName: stored.stageName,
        stageOrder: stored.stageOrder,
        status: stored.status,
        completedAt: stored.completedAt,
        notes: stored.notes,
      };
    }),
    taskSummary: buildMonthlyCloseSummary(periodTasks, today),
    periodTasks,
  };
}

/**
 * Moves one stage and re-derives the close.
 *
 * Stages have no transition table — legacy's stage columns were plain
 * validated dropdowns, exactly like issue and request status (Phase 6), and
 * its `onEdit` handler routed only `TASKS.Status`. Any stage status may follow
 * any other.
 *
 * What legacy DID do is recompute Completion % and Close Status from the
 * stage row on every edit, via live formulas. That is reproduced here as an
 * explicit recalculation, so the stored values can never disagree with the
 * stages they summarise.
 */
export async function changeStageStatus(
  ctx: OrgContext,
  closeId: string,
  stageId: string,
  status: CloseStageStatus,
  today: Date = new Date(),
): Promise<void> {
  const close = await prisma.monthlyClose.findFirst({
    where: { id: closeId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, clientId: true, period: true, status: true },
  });
  if (!close) throw new ForbiddenError("Close not found in this organization.");

  const stage = await prisma.monthlyCloseTask.findFirst({
    where: { id: stageId, monthlyCloseId: closeId },
    select: { id: true, stageName: true, status: true },
  });
  if (!stage) throw new ForbiddenError("Stage not found on this close.");

  if (stage.status === status) return;

  await prisma.monthlyCloseTask.update({
    where: { id: stageId },
    data: {
      status,
      // Completing stamps the date; moving back off Completed clears it, so a
      // reopened stage does not claim it finished.
      completedAt: status === CloseStageStatus.COMPLETED ? today : null,
    },
  });

  await recalculateClose(ctx, closeId, today);

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.CLOSE_STAGE_CHANGED,
    entityType: EntityType.MONTHLY_CLOSE,
    entityId: closeId,
    clientId: close.clientId,
    previousValue: `${stage.stageName}: ${stage.status}`,
    newValue: `${stage.stageName}: ${status}`,
  });
}

/**
 * Re-derives Completion % and Close Status from the stage rows.
 *
 * Exported because generation and imports also need it — anything that writes
 * stages must leave the summary consistent.
 */
export async function recalculateClose(
  ctx: OrgContext,
  closeId: string,
  today: Date = new Date(),
): Promise<{ completionPct: number; status: CloseStatus }> {
  const stages = await prisma.monthlyCloseTask.findMany({
    where: { monthlyCloseId: closeId },
    select: { stageName: true, stageOrder: true, status: true },
  });

  const domainStages: DomainCloseStage[] = stages.map((stage) => ({
    stageName: stage.stageName,
    stageOrder: stage.stageOrder,
    status: stage.status,
  }));

  const completionPct = computeCloseCompletion(domainStages);
  const status = computeCloseStatus(domainStages);

  const previous = await prisma.monthlyClose.findUniqueOrThrow({
    where: { id: closeId },
    select: { status: true, closedAt: true },
  });

  await prisma.monthlyClose.update({
    where: { id: closeId },
    data: {
      completionPct,
      status,
      // closedAt is stamped when the close first reaches Closed and cleared if
      // it leaves that state, mirroring how a task's completion date behaves.
      closedAt:
        status === CloseStatus.CLOSED
          ? (previous.closedAt ?? today)
          : null,
    },
  });

  if (previous.status !== status) {
    const close = await prisma.monthlyClose.findUniqueOrThrow({
      where: { id: closeId },
      select: { clientId: true },
    });
    await logActivity(ctx, {
      action: ACTIVITY_ACTIONS.CLOSE_STATUS_CHANGED,
      entityType: EntityType.MONTHLY_CLOSE,
      entityId: closeId,
      clientId: close.clientId,
      previousValue: previous.status,
      newValue: status,
    });
  }

  return { completionPct, status };
}

/** Review status and notes — the two fields staff edit directly. */
export async function updateClose(
  ctx: OrgContext,
  closeId: string,
  reviewStatus: ReviewStatus,
  notes: string | null,
): Promise<void> {
  const close = await prisma.monthlyClose.findFirst({
    where: { id: closeId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, clientId: true, reviewStatus: true },
  });
  if (!close) throw new ForbiddenError("Close not found in this organization.");

  await prisma.monthlyClose.update({
    where: { id: closeId },
    data: { reviewStatus, notes },
  });

  if (close.reviewStatus !== reviewStatus) {
    await logActivity(ctx, {
      action: ACTIVITY_ACTIONS.CLOSE_REVIEW_CHANGED,
      entityType: EntityType.MONTHLY_CLOSE,
      entityId: closeId,
      clientId: close.clientId,
      previousValue: close.reviewStatus,
      newValue: reviewStatus,
    });
  }
}

/** Select options for the close list filters and the open-close form. */
export async function getCloseFormOptions(ctx: OrgContext) {
  const [clients, periods] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, displayId: true },
    }),
    prisma.monthlyClose.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      distinct: ["period"],
      orderBy: { period: "desc" },
      select: { period: true },
      take: 24,
    }),
  ]);

  return { clients, periods: periods.map((row) => row.period) };
}
