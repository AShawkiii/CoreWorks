import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatPeriod } from "@/lib/domain/date";
import type { Period } from "@/lib/domain/types";
import { systemContext, type OrgContext } from "@/server/context";
import { recalculateAllClientsHealth } from "@/server/services/health";
import { recalculateAllClientsProgress } from "@/server/services/progress";
import { generateMonthlyTasks } from "@/server/services/task-generation";

/**
 * Scheduled jobs (audit §9).
 *
 * Legacy ran three time-based triggers:
 *
 * | Trigger | Schedule | Action |
 * |---|---|---|
 * | `dailyRecalculation` | daily 02:00 | recalc all progress + health |
 * | `runMonthlyTaskGeneration` | monthly, day 1, 03:00 | generate the period |
 * | `generateMonthlyManagementReport` | monthly, day 1, 04:00 | build report |
 *
 * The first is not a convenience. The audit is explicit: **overdue-ness is
 * time-dependent, not event-dependent** — a task becomes overdue because the
 * date rolled over, with nobody editing anything — so health and progress go
 * stale without a pass that runs on a clock. CoreWorks recalculates on every
 * relevant mutation, which covers the event-driven half; this job covers the
 * other half.
 *
 * The third legacy trigger is not reproduced: the Management Report is derived
 * live on request (Phase 9), so there is nothing to pre-build. Its numbers are
 * always current rather than as at the last 04:00 run.
 *
 * These functions are the work itself, with no scheduler bound to them. They
 * are driven by `scripts/run-job.ts` for cron and by the admin actions in
 * `src/server/actions/jobs.ts` for an on-demand run, so the same code path
 * serves both and cannot drift.
 */

export interface JobRunResult {
  job: string;
  organizationId: string;
  organizationSlug: string;
  startedAt: Date;
  finishedAt: Date;
  details: Record<string, number | string>;
}

/**
 * Legacy `dailyRecalculation`.
 *
 * Progress first, then health: the health rule reads overdue counts and open
 * issues, and progress writes the completion columns health reports alongside.
 * Running them in the other order would publish a health verdict against
 * yesterday's numbers for one pass.
 */
export async function runDailyRecalculation(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<JobRunResult> {
  const startedAt = new Date();

  const clientsProcessed = await recalculateAllClientsProgress(
    ctx.organizationId,
  );
  const healthChanged = await recalculateAllClientsHealth(ctx, today);

  return {
    job: "daily-recalculation",
    organizationId: ctx.organizationId,
    organizationSlug: ctx.organizationSlug,
    startedAt,
    finishedAt: new Date(),
    details: { clientsProcessed, healthChanged },
  };
}

/**
 * Legacy `runMonthlyTaskGeneration`.
 *
 * Safe to re-run: generation is keyed on
 * `clientId|serviceArea|taskName|period`, so a second pass over the same
 * period creates nothing and prior periods are never touched (audit §6.11).
 * That is what makes an on-demand button as safe as the 03:00 trigger.
 */
export async function runMonthlyGeneration(
  ctx: OrgContext,
  targetPeriod?: Period,
  today: Date = new Date(),
): Promise<JobRunResult> {
  const startedAt = new Date();
  const period = targetPeriod ?? formatPeriod(today);

  const result = await generateMonthlyTasks(ctx, period, today);

  return {
    job: "monthly-generation",
    organizationId: ctx.organizationId,
    organizationSlug: ctx.organizationSlug,
    startedAt,
    finishedAt: new Date(),
    details: {
      period,
      clientsProcessed: result.clientsProcessed,
      tasksCreated: result.tasksCreated,
    },
  };
}

/**
 * Every organization, for a scheduler that runs once for the whole
 * deployment rather than per tenant.
 *
 * Each organization is processed independently: one failing must not stop the
 * rest, so failures are collected and reported rather than thrown. A cron that
 * aborts halfway leaves half the tenants stale with no signal.
 */
export async function forEachOrganization(
  run: (ctx: OrgContext) => Promise<JobRunResult>,
): Promise<{ results: JobRunResult[]; failures: { slug: string; error: string }[] }> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  const results: JobRunResult[] = [];
  const failures: { slug: string; error: string }[] = [];

  for (const org of organizations) {
    // A scheduled run has no signed-in user. `systemContext` records that
    // explicitly — activity written by this pass carries a null userId and the
    // system email snapshot, rather than being attributed to a member of staff.
    const ctx = systemContext(org.id, org.slug, OrgRole.OWNER);

    try {
      results.push(await run(ctx));
    } catch (error) {
      failures.push({
        slug: org.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, failures };
}
