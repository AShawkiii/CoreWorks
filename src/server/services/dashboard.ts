import { prisma } from "@/lib/db";
import type { ControlCenterViewModel } from "@/lib/domain/view-models/control-center";
import { buildControlCenterViewModel } from "@/lib/domain/view-models/control-center";
import {
  buildManagementReport,
  type ManagementReport,
} from "@/lib/domain/view-models/management-report";
import {
  buildTeamDashboardRows,
  type TeamDashboardRow,
} from "@/lib/domain/view-models/team-dashboard";
import type { OrgContext } from "@/server/context";
import {
  clientSelect,
  issueSelect,
  memberSelect,
  requestSelect,
  taskSelect,
  toDomainClient,
  toDomainIssue,
  toDomainMember,
  toDomainRequest,
  toDomainTask,
} from "@/server/services/mappers";
import { getOrgSettings } from "@/server/services/settings";

/**
 * Dashboard services.
 *
 * These gather data and hand it to the pure view-model builders. No metric is
 * computed here — that is the point of the split. Every query is scoped by
 * `ctx.organizationId`, which comes from the session (master prompt §6).
 */

const activeScope = (organizationId: string) => ({
  organizationId,
  deletedAt: null,
});

/** Legacy `buildControlCenterViewModel` — the 14 KPIs, health table, and surfaced issues. */
export async function getControlCenterViewModel(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<ControlCenterViewModel> {
  const scope = activeScope(ctx.organizationId);

  const [clientRows, taskRows, issueRows] = await Promise.all([
    prisma.client.findMany({ where: scope, select: clientSelect }),
    prisma.task.findMany({ where: scope, select: taskSelect }),
    prisma.issue.findMany({ where: scope, select: issueSelect }),
  ]);

  return buildControlCenterViewModel(
    clientRows.map(toDomainClient),
    taskRows.map(toDomainTask),
    issueRows.map(toDomainIssue),
    today,
  );
}

/** Legacy `renderTeamDashboard`. */
export async function getTeamDashboard(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<TeamDashboardRow[]> {
  const scope = activeScope(ctx.organizationId);

  const [memberRows, taskRows, settings] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: memberSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.findMany({ where: scope, select: taskSelect }),
    getOrgSettings(ctx.organizationId),
  ]);

  return buildTeamDashboardRows(
    memberRows.map(toDomainMember),
    taskRows.map(toDomainTask),
    today,
    settings.WORKLOAD_OVERLOAD_MARGIN,
  );
}

/** Legacy `buildManagementReport`. */
export async function getManagementReport(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<ManagementReport> {
  const scope = activeScope(ctx.organizationId);

  const [clientRows, taskRows, issueRows, requestRows, memberRows, settings] =
    await Promise.all([
      prisma.client.findMany({ where: scope, select: clientSelect }),
      prisma.task.findMany({ where: scope, select: taskSelect }),
      prisma.issue.findMany({ where: scope, select: issueSelect }),
      prisma.clientRequest.findMany({ where: scope, select: requestSelect }),
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: memberSelect,
        orderBy: { createdAt: "asc" },
      }),
      getOrgSettings(ctx.organizationId),
    ]);

  return buildManagementReport(
    clientRows.map(toDomainClient),
    taskRows.map(toDomainTask),
    issueRows.map(toDomainIssue),
    requestRows.map(toDomainRequest),
    memberRows.map(toDomainMember),
    settings.REQUEST_STALE_DAYS,
    today,
  );
}
