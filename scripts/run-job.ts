import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  forEachOrganization,
  runDailyRecalculation,
  runMonthlyGeneration,
} from "../src/server/jobs/scheduled";

/**
 * Scheduled-job runner (audit §9).
 *
 * Legacy used Apps Script's own time-based triggers. CoreWorks has no runtime
 * scheduler of its own — deliberately, because the right one depends on where
 * it is deployed — so this is the entry point a real scheduler calls:
 *
 *   npm run job -- daily-recalculation      # cron: 0 2 * * *
 *   npm run job -- monthly-generation       # cron: 0 3 1 * *
 *   npm run job -- monthly-generation 2026-09
 *
 * It runs across EVERY organization, since a deployment-level cron is not
 * signed in as any tenant. A failure in one is reported and the rest continue,
 * and the exit code is non-zero if any failed — so a silent partial run cannot
 * look like success to the scheduler.
 */

const JOBS = ["daily-recalculation", "monthly-generation"] as const;
type JobName = (typeof JOBS)[number];

function usage(): never {
  console.error(`Usage: npm run job -- <${JOBS.join("|")}> [period]`);
  console.error("  period is YYYY-MM and applies to monthly-generation only.");
  process.exit(2);
}

async function main() {
  const [job, period] = process.argv.slice(2);

  if (!job || !(JOBS as readonly string[]).includes(job)) usage();
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    console.error(`Invalid period "${period}" — expected YYYY-MM.`);
    process.exit(2);
  }

  const name = job as JobName;
  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] running ${name}...`);

  const { results, failures } = await forEachOrganization((ctx) =>
    name === "daily-recalculation"
      ? runDailyRecalculation(ctx)
      : runMonthlyGeneration(ctx, period),
  );

  for (const result of results) {
    const ms = result.finishedAt.getTime() - result.startedAt.getTime();
    const detail = Object.entries(result.details)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.log(`  ${result.organizationSlug.padEnd(24)} ${detail} (${ms}ms)`);
  }

  for (const failure of failures) {
    console.error(`  FAILED ${failure.slug}: ${failure.error}`);
  }

  console.log(
    `[${new Date().toISOString()}] ${name}: ${results.length} ok, ${failures.length} failed`,
  );

  await prisma.$disconnect();
  // Non-zero on any failure, so the scheduler can alert rather than assume.
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
