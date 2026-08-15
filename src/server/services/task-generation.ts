import { ContractStatus, EntityType, TaskCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resolveDefaultAssignee } from "@/lib/domain/client";
import {
  computeTaskDueDate,
  formatPeriod,
  frequencyHitsPeriod,
} from "@/lib/domain/date";
import { expandTemplateToTask, taskDedupeKey } from "@/lib/domain/template";
import type { Period } from "@/lib/domain/types";
import type { OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import {
  memberSelect,
  templateSelect,
  toDomainMember,
  toDomainTemplate,
} from "@/server/services/mappers";
import { recalculateClientHealth } from "@/server/services/health";
import { recalculateClientProgress } from "@/server/services/progress";
import { getOrgSettings } from "@/server/services/settings";
import { createTask } from "@/server/services/tasks";

/**
 * Task generation.
 *
 * Port of legacy `tasks/TaskGenerationOnboarding.gs` and
 * `tasks/TaskGenerationMonthly.gs` (audit §6.11).
 *
 * Both paths share `expandTemplateToTask` and the same dedupe key, exactly as
 * legacy did, so onboarding-generated and monthly-generated tasks can never be
 * built by two different rules.
 *
 * Both are safe to re-run: a (client, service area, task name, period)
 * combination that already exists is skipped, and prior periods are never
 * touched.
 */

export interface GenerationResult {
  period: Period;
  clientsProcessed: number;
  tasksCreated: number;
}

async function loadGenerationContext(organizationId: string) {
  const [memberRows, settings] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId, deletedAt: null },
      select: memberSelect,
      orderBy: { createdAt: "asc" },
    }),
    getOrgSettings(organizationId),
  ]);

  return { members: memberRows.map(toDomainMember), settings };
}

async function templatesForPackage(
  organizationId: string,
  servicePackageId: string | null,
) {
  if (!servicePackageId) return [];

  const rows = await prisma.taskTemplate.findMany({
    where: {
      organizationId,
      servicePackageId,
      isActive: true,
      deletedAt: null,
    },
    select: templateSelect,
    orderBy: { displayId: "asc" },
  });

  return rows.map(toDomainTemplate);
}

/** Existing dedupe keys for a client, so generation can skip what exists. */
async function existingKeysForClient(
  organizationId: string,
  clientId: string,
): Promise<Set<string>> {
  const rows = await prisma.task.findMany({
    where: { organizationId, clientId, deletedAt: null },
    select: { clientId: true, serviceArea: true, taskName: true, period: true },
  });

  return new Set(
    rows.map((row) =>
      taskDedupeKey(row.clientId, row.serviceArea, row.taskName, row.period),
    ),
  );
}

/**
 * Legacy `generateOnboardingTasks`.
 *
 * Due dates use the SAME rule as monthly generation rather than
 * "today + duration". Legacy is explicit about why: same-day due dates
 * produced unrealistically tight deadlines and made every brand-new client
 * look At Risk immediately.
 */
export async function generateOnboardingTasks(
  ctx: OrgContext,
  clientId: string,
  today: Date = new Date(),
): Promise<{ clientId: string; tasksCreated: number }> {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePackageId: true,
      accountManager: { select: { user: { select: { name: true } } } },
    },
  });
  if (!client) return { clientId, tasksCreated: 0 };

  const { members, settings } = await loadGenerationContext(ctx.organizationId);
  const templates = await templatesForPackage(
    ctx.organizationId,
    client.servicePackageId,
  );
  const existingKeys = await existingKeysForClient(ctx.organizationId, clientId);

  const period = formatPeriod(today);
  const accountManagerName = client.accountManager?.user.name ?? null;
  let tasksCreated = 0;

  for (const template of templates) {
    const key = taskDedupeKey(
      clientId,
      template.serviceArea,
      template.taskName,
      period,
    );
    if (existingKeys.has(key)) continue;

    const dueDate = computeTaskDueDate(
      period,
      template.serviceArea,
      template.typicalDurationDays,
      settings.MONTHLY_CLOSE_DEFAULT_DUE_DAY,
    );
    const assignee = resolveDefaultAssignee(
      template.defaultAssigneeRole,
      accountManagerName,
      members,
    );

    const expanded = expandTemplateToTask(
      template,
      clientId,
      period,
      dueDate,
      assignee,
      TaskCategory.ONBOARDING,
    );

    await createTask(ctx, expanded, { skipLog: true });
    existingKeys.add(key);
    tasksCreated += 1;
  }

  if (tasksCreated > 0) {
    await logActivity(ctx, {
      action: ACTIVITY_ACTIONS.ONBOARDING_TASKS_GENERATED,
      entityType: EntityType.CLIENT,
      entityId: clientId,
      clientId,
      newValue: `${tasksCreated} tasks created`,
    });
  }

  return { clientId, tasksCreated };
}

/**
 * Legacy `generateMonthlyTasks`.
 *
 * Runs for ACTIVE clients only — Onboarding, On Hold, Completed, and
 * Cancelled clients do not accrue recurring work. Logs one summary activity
 * per run rather than one per task.
 */
export async function generateMonthlyTasks(
  ctx: OrgContext,
  targetPeriod?: Period,
  today: Date = new Date(),
): Promise<GenerationResult> {
  const period = targetPeriod ?? formatPeriod(today);
  const { members, settings } = await loadGenerationContext(ctx.organizationId);

  const clients = await prisma.client.findMany({
    where: {
      organizationId: ctx.organizationId,
      contractStatus: ContractStatus.ACTIVE,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePackageId: true,
      accountManager: { select: { user: { select: { name: true } } } },
    },
  });

  let tasksCreated = 0;

  for (const client of clients) {
    const templates = await templatesForPackage(
      ctx.organizationId,
      client.servicePackageId,
    );
    const existingKeys = await existingKeysForClient(
      ctx.organizationId,
      client.id,
    );

    // Legacy's "first period for this client" test — a client with no tasks
    // at all is having its first period generated, which is what makes
    // One-Time templates fire exactly once.
    const isFirstPeriodForClient = existingKeys.size === 0;
    const accountManagerName = client.accountManager?.user.name ?? null;

    for (const template of templates) {
      if (
        !frequencyHitsPeriod(template.frequency, period, isFirstPeriodForClient)
      ) {
        continue;
      }

      const key = taskDedupeKey(
        client.id,
        template.serviceArea,
        template.taskName,
        period,
      );
      if (existingKeys.has(key)) continue;

      const dueDate = computeTaskDueDate(
        period,
        template.serviceArea,
        template.typicalDurationDays,
        settings.MONTHLY_CLOSE_DEFAULT_DUE_DAY,
      );
      const assignee = resolveDefaultAssignee(
        template.defaultAssigneeRole,
        accountManagerName,
        members,
      );

      const expanded = expandTemplateToTask(
        template,
        client.id,
        period,
        dueDate,
        assignee,
        TaskCategory.RECURRING,
      );

      await createTask(ctx, expanded, { skipLog: true });
      existingKeys.add(key);
      tasksCreated += 1;
    }

    if (tasksCreated > 0) {
      await recalculateClientProgress(ctx.organizationId, client.id);
      await recalculateClientHealth(ctx, client.id, today);
    }
  }

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.MONTHLY_TASKS_GENERATED,
    entityType: EntityType.SYSTEM,
    entityId: period,
    newValue: `${tasksCreated} tasks for ${clients.length} active clients`,
  });

  return { period, clientsProcessed: clients.length, tasksCreated };
}
