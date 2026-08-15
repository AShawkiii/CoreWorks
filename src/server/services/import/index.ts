import type { LegacySheet } from "@/lib/domain/legacy-schema";
import type { OrgContext } from "@/server/context";

import {
  employeeAdapter,
  serviceAdapter,
  servicePackageAdapter,
  taskTemplateAdapter,
} from "./adapters-catalog";
import {
  activityAdapter,
  clientAdapter,
  issueAdapter,
  monthlyCloseAdapter,
  requestAdapter,
  settingAdapter,
  taskAdapter,
} from "./adapters-records";
import { runImport } from "./engine";
import type { ImportAdapter, ImportReport } from "./types";

/**
 * A runner with the adapter's row type already erased.
 *
 * Each adapter has its own row type and they are never mixed, so the registry
 * only needs to know that a runner exists. Closing over the adapter here —
 * where its type is still known — keeps `runImport` fully generic and means
 * the registry needs no cast at all.
 */
type SheetRunner = (
  ctx: OrgContext,
  csvText: string,
  options: { dryRun: boolean },
) => Promise<ImportReport>;

function runner<T>(adapter: ImportAdapter<T>): SheetRunner {
  return (ctx, csvText, options) => runImport(ctx, adapter, csvText, options);
}

/**
 * The adapter registry.
 *
 * One entry per legacy data sheet (migration-plan §3.1). Typed as
 * `Record<LegacySheet, SheetRunner>` so adding a sheet to `LEGACY_HEADERS`
 * without writing its adapter is a compile error rather than a runtime
 * "unsupported file" the operator discovers mid-migration.
 */
const RUNNERS: Record<LegacySheet, SheetRunner> = {
  EMPLOYEES: runner(employeeAdapter),
  SERVICES: runner(serviceAdapter),
  SERVICE_PACKAGES: runner(servicePackageAdapter),
  TASK_TEMPLATES: runner(taskTemplateAdapter),
  CLIENTS: runner(clientAdapter),
  TASKS: runner(taskAdapter),
  CLIENT_REQUESTS: runner(requestAdapter),
  ISSUES: runner(issueAdapter),
  MONTHLY_CLOSE: runner(monthlyCloseAdapter),
  ACTIVITY_LOG: runner(activityAdapter),
  SETTINGS: runner(settingAdapter),
};

/**
 * Validates a file without writing anything, then reports what would happen.
 *
 * The preview is a real transaction that is rolled back, so it exercises the
 * actual inserts, foreign keys, and unique constraints — not a re-implementation
 * of them that can drift from the import it claims to predict.
 */
export function previewImport(
  ctx: OrgContext,
  sheet: LegacySheet,
  csvText: string,
): Promise<ImportReport> {
  return RUNNERS[sheet](ctx, csvText, { dryRun: true });
}

/** Commits the file. Same code path as the preview, without the rollback. */
export function commitImport(
  ctx: OrgContext,
  sheet: LegacySheet,
  csvText: string,
): Promise<ImportReport> {
  return RUNNERS[sheet](ctx, csvText, { dryRun: false });
}

export { RUNNERS };
export type { ImportReport } from "./types";
export { assertBucketsSumToTotal, checkPrerequisites, ImportError } from "./engine";
