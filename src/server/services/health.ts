import { EntityType, Priority } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { computeDaysOverdue, daysBetween } from "@/lib/domain/date";
import { CLIENT_HEALTH_LABELS } from "@/lib/domain/labels";
import type { ClientHealth } from "@/lib/domain/enums";
import { IssueSeverity } from "@/lib/domain/enums";
import { computeClientHealth } from "@/lib/domain/health";
import { isIssueOpen } from "@/lib/domain/issue";
import { computeNextDeadline } from "@/lib/domain/progress";
import type { HealthStats } from "@/lib/domain/types";
import type { OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { notifyClientHealthChanged } from "@/server/services/notifications";
import {
  issueSelect,
  taskSelect,
  toDomainIssue,
  toDomainTask,
} from "@/server/services/mappers";
import { getOrgSettings, healthThresholdsFrom } from "@/server/services/settings";

/**
 * Health engine.
 *
 * Port of legacy `clients/HealthEngine.gs` (audit §6.1) — the I/O wrapper that
 * gathers the statistics `computeClientHealth` needs and writes the result.
 *
 * One legacy decision is preserved deliberately: overdue-ness is recomputed
 * from raw due date and status rather than read from a stored column. Legacy
 * did this so the engine stays correct the instant a status changes, before
 * any recalculation pass has run. The same reasoning applies here.
 */

/** Gathers the six inputs for one client. Exported for testing. */
export async function gatherHealthStats(
  organizationId: string,
  clientId: string,
  today: Date,
): Promise<HealthStats | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { contractStatus: true },
  });
  if (!client) return null;

  const [taskRows, issueRows] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId, clientId, deletedAt: null },
      select: taskSelect,
    }),
    prisma.issue.findMany({
      where: { organizationId, clientId, deletedAt: null },
      select: issueSelect,
    }),
  ]);

  const tasks = taskRows.map(toDomainTask);
  const issues = issueRows.map(toDomainIssue);

  let overdueCount = 0;
  let criticalOverdueCount = 0;
  for (const task of tasks) {
    if (computeDaysOverdue(task.dueDate, task.status, today) > 0) {
      overdueCount += 1;
      if (task.priority === Priority.CRITICAL) criticalOverdueCount += 1;
    }
  }

  const openIssues = issues.filter((issue) => isIssueOpen(issue.status));

  // Deliberately scoped to Critical/High open tasks — see the rule's docblock.
  const importantTasks = tasks.filter(
    (task) =>
      task.priority === Priority.CRITICAL || task.priority === Priority.HIGH,
  );
  const nextImportantDeadline = computeNextDeadline(importantTasks);

  return {
    contractStatus: client.contractStatus,
    overdueCount,
    criticalOverdueCount,
    openCriticalIssueCount: openIssues.filter(
      (issue) => issue.severity === IssueSeverity.CRITICAL,
    ).length,
    openHighIssueCount: openIssues.filter(
      (issue) => issue.severity === IssueSeverity.HIGH,
    ).length,
    daysToNextImportantDeadline: nextImportantDeadline
      ? daysBetween(nextImportantDeadline, today)
      : null,
  };
}

/**
 * Recalculates and stores one client's health.
 *
 * Logs a `Client Health Changed` activity only when the value actually
 * changes — legacy's rule that pure recalculation is never logged, so the
 * activity feed shows real transitions rather than every nightly pass.
 */
export async function recalculateClientHealth(
  ctx: OrgContext,
  clientId: string,
  today: Date = new Date(),
): Promise<ClientHealth | null> {
  const stats = await gatherHealthStats(ctx.organizationId, clientId, today);
  if (!stats) return null;

  const settings = await getOrgSettings(ctx.organizationId);
  const newHealth = computeClientHealth(stats, healthThresholdsFrom(settings));

  const current = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    select: { health: true },
  });
  if (!current) return null;

  if (current.health === newHealth) return newHealth;

  await prisma.client.update({
    where: { id: clientId },
    data: { health: newHealth },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.CLIENT_HEALTH_CHANGED,
    entityType: EntityType.CLIENT,
    entityId: clientId,
    clientId,
    previousValue: CLIENT_HEALTH_LABELS[current.health],
    newValue: CLIENT_HEALTH_LABELS[newHealth],
  });

  // Phase 11. Sits inside the same "only when it actually changed" guard as
  // the activity entry above, so the nightly pass that re-confirms On Track
  // notifies nobody. Recipients are the client's account manager and backup —
  // see the emitter for why it is not everyone with client:view.
  await notifyClientHealthChanged(ctx, clientId, current.health, newHealth);

  return newHealth;
}

/**
 * Legacy `recalculateAllClientsHealth` — the daily safety-net pass.
 *
 * Necessary because overdue-ness is time-dependent, not event-dependent: a
 * task becomes overdue as the date rolls over, with no edit to trigger a
 * recalculation.
 */
export async function recalculateAllClientsHealth(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<number> {
  const clients = await prisma.client.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });

  let changed = 0;
  for (const client of clients) {
    const before = await prisma.client.findUnique({
      where: { id: client.id },
      select: { health: true },
    });
    const after = await recalculateClientHealth(ctx, client.id, today);
    if (after && before && after !== before.health) changed += 1;
  }

  return changed;
}

/** Unstored preview of what health WOULD be — used by tests and diagnostics. */
export async function previewClientHealth(
  organizationId: string,
  clientId: string,
  today: Date = new Date(),
): Promise<ClientHealth | null> {
  const stats = await gatherHealthStats(organizationId, clientId, today);
  if (!stats) return null;
  const settings = await getOrgSettings(organizationId);
  return computeClientHealth(stats, healthThresholdsFrom(settings));
}

