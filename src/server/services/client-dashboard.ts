import { prisma } from "@/lib/db";
import {
  buildClientDetailIssueRows,
  buildClientDetailRequestRows,
  buildClientDetailTaskRows,
  type ClientDetailIssueRow,
  type ClientDetailRequestRow,
  type ClientDetailTaskRow,
} from "@/lib/domain/view-models/clients";
import {
  buildClientTaskSummary,
  buildServiceAreaProgress,
  buildUpcomingDeadlines,
  type ClientTaskSummary,
  type ServiceAreaProgress,
  type UpcomingDeadline,
} from "@/lib/domain/view-models/client-dashboard";
import { isIssueOpen } from "@/lib/domain/issue";
import { isRequestOpen } from "@/lib/domain/request";
import { isTaskOpen } from "@/lib/domain/task";
import type { DomainClient } from "@/lib/domain/types";
import type { OrgContext } from "@/server/context";
import {
  clientSelect,
  issueSelect,
  requestSelect,
  taskSelect,
  toDomainClient,
  toDomainIssue,
  toDomainRequest,
  toDomainTask,
} from "@/server/services/mappers";

/**
 * Client Dashboard service.
 *
 * Port of legacy `dashboards/ClientDashboardEngine.gs` (audit §8.4) — the
 * dropdown-driven single-client view. The picker cell becomes a `?clientId=`
 * query parameter; everything else is the same seven sections in the same
 * order.
 *
 * No metric is computed here. The seven summary cards, service-area progress,
 * and upcoming deadlines come from the Phase 3 port of that engine; the open
 * task, request, and issue tables come from the Phase 3 port of the Web App's
 * client detail view model, whose own comment records that it followed this
 * sheet's precedent for exactly those three sections.
 */

/** Legacy `DEADLINES_MAX_ROWS`. */
export const UPCOMING_DEADLINES_LIMIT = 10;

export interface ClientDashboard {
  client: DomainClient;
  summary: ClientTaskSummary;
  serviceProgress: ServiceAreaProgress[];
  /** Legacy `writeCurrentTasksTable` — open tasks, soonest due first. */
  currentTasks: ClientDetailTaskRow[];
  /** Legacy `writeClientRequestsTable` — open requests only. */
  requests: ClientDetailRequestRow[];
  /** Legacy `writeIssuesTable` — open issues only. */
  issues: ClientDetailIssueRow[];
  upcomingDeadlines: UpcomingDeadline[];
  generatedAt: Date;
}

/** Clients available in the picker, always org-scoped. */
export async function getClientPickerOptions(ctx: OrgContext) {
  return prisma.client.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, displayId: true },
  });
}

/**
 * Builds the dashboard for one client.
 *
 * Returns null when the id does not resolve inside the caller's organization
 * — the same answer for "no such client" and "not yours", so the page cannot
 * be used to probe which ids exist elsewhere. Legacy's engine cleared the
 * sheet when the picker held an unknown name; this is that behaviour with a
 * tenancy boundary added.
 */
export async function getClientDashboard(
  ctx: OrgContext,
  clientId: string,
  today: Date = new Date(),
): Promise<ClientDashboard | null> {
  const clientRow = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId, deletedAt: null },
    select: clientSelect,
  });
  if (!clientRow) return null;

  const scope = {
    organizationId: ctx.organizationId,
    clientId,
    deletedAt: null,
  };

  const [taskRows, issueRows, requestRows] = await Promise.all([
    prisma.task.findMany({ where: scope, select: taskSelect }),
    prisma.issue.findMany({ where: scope, select: issueSelect }),
    prisma.clientRequest.findMany({ where: scope, select: requestSelect }),
  ]);

  const tasks = taskRows.map(toDomainTask);
  const issues = issueRows.map(toDomainIssue);
  const requests = requestRows.map(toDomainRequest);

  // The three tables show OPEN items only, as both the legacy sheet engine and
  // the Web App client detail do. The summary cards and service progress see
  // every task, because they report on the whole engagement.
  const openTasks = tasks.filter((task) => isTaskOpen(task.status));
  const openIssues = issues.filter((issue) => isIssueOpen(issue.status));
  const openRequests = requests.filter((request) =>
    isRequestOpen(request.status),
  );

  return {
    client: toDomainClient(clientRow),
    summary: buildClientTaskSummary(tasks, today),
    serviceProgress: buildServiceAreaProgress(tasks),
    currentTasks: buildClientDetailTaskRows(openTasks, today),
    requests: buildClientDetailRequestRows(openRequests, today),
    issues: buildClientDetailIssueRows(openIssues),
    upcomingDeadlines: buildUpcomingDeadlines(
      tasks,
      today,
      UPCOMING_DEADLINES_LIMIT,
    ),
    generatedAt: today,
  };
}
