import { prisma } from "@/lib/db";
import {
  computeNextDeadline,
  computeSimpleCompletion,
  computeWeightedCompletion,
} from "@/lib/domain/progress";
import { taskSelect, toDomainTask } from "@/server/services/mappers";

/**
 * Progress engine.
 *
 * Port of legacy `tasks/ProgressEngine.gs` (audit §6.2) — recomputes and
 * stores a client's Simple and Weighted Completion % and Next Deadline.
 *
 * These three are stored rather than derived on read because they are sorted
 * and filtered across the whole client list; recomputing them per row on every
 * dashboard render would mean loading every task for every client. They are
 * refreshed whenever a task changes and by the daily pass.
 */

export interface ProgressResult {
  simpleCompletionPct: number;
  weightedCompletionPct: number;
  nextDeadline: Date | null;
}

export async function recalculateClientProgress(
  organizationId: string,
  clientId: string,
): Promise<ProgressResult | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return null;

  const taskRows = await prisma.task.findMany({
    where: { organizationId, clientId, deletedAt: null },
    select: taskSelect,
  });
  const tasks = taskRows.map(toDomainTask);

  const result: ProgressResult = {
    simpleCompletionPct: computeSimpleCompletion(tasks).pct,
    weightedCompletionPct: computeWeightedCompletion(tasks).pct,
    nextDeadline: computeNextDeadline(tasks),
  };

  await prisma.client.update({
    where: { id: clientId },
    data: {
      simpleCompletionPct: result.simpleCompletionPct,
      weightedCompletionPct: result.weightedCompletionPct,
      nextDeadline: result.nextDeadline,
    },
  });

  return result;
}

/** Legacy `recalculateAllClientsProgress` — the daily safety-net pass. */
export async function recalculateAllClientsProgress(
  organizationId: string,
): Promise<number> {
  const clients = await prisma.client.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true },
  });

  for (const client of clients) {
    await recalculateClientProgress(organizationId, client.id);
  }

  return clients.length;
}
