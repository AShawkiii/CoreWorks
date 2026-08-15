"use server";

import { revalidatePath } from "next/cache";

import type { LegacySheet } from "@/lib/domain/legacy-schema";
import {
  exportRequestSchema,
  importRequestSchema,
} from "@/lib/validation/data-transfer";
import { ForbiddenError, requirePermission } from "@/server/tenancy";
import { exportSheet } from "@/server/services/export";
import { commitImport, previewImport } from "@/server/services/import";
import type { ImportReport } from "@/server/services/import/types";

/**
 * Import and export server actions.
 *
 * Two different permissions, and the split is the one the RBAC matrix already
 * declared in Phase 2:
 *
 *  - **`data:import`** — Manager and above. An import writes records in bulk
 *    and is the single most consequential thing a non-admin can do to this
 *    data set.
 *  - **`data:export`** — Team Member and above. An export is a read, and staff
 *    who work the queue legitimately need their own data in a spreadsheet.
 *
 * A Viewer holds neither. That is deliberate: a Viewer can see the screens,
 * but an export is a bulk extraction of the entire book of business, which is
 * a different act from reading one page of it.
 */

export interface ImportActionState {
  status?: "success" | "error";
  message?: string;
  report?: ImportReport;
}

export interface ExportActionState {
  status?: "success" | "error";
  message?: string;
  filename?: string;
  csv?: string;
  rowCount?: number;
}

function refusal(error: unknown, fallback: string): string {
  if (error instanceof ForbiddenError) return error.message;
  console.error("Unhandled data-transfer action error:", error);
  return fallback;
}

/**
 * Previews or commits a CSV import.
 *
 * One action for both, because they are one operation with a flag — the
 * preview runs the same engine inside a transaction that is rolled back
 * (migration-plan §4: *"Preview is a dry run over the real validators"*).
 * Splitting them into two actions would create exactly the drift that rule
 * exists to prevent.
 */
export async function importCsvAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  try {
    const ctx = await requirePermission("data:import");

    const parsed = importRequestSchema.safeParse({
      sheet: formData.get("sheet") ?? "",
      file: formData.get("file"),
      commit: formData.get("commit") ?? "false",
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        status: "error",
        message: first?.message ?? "Check the data set and the file.",
      };
    }

    const { sheet, file, commit } = parsed.data;
    const csvText = await file.text();

    const report = commit
      ? await commitImport(ctx, sheet as LegacySheet, csvText)
      : await previewImport(ctx, sheet as LegacySheet, csvText);

    if (report.fatal) {
      return { status: "error", message: report.fatal, report };
    }

    if (commit) {
      // An import rewrites almost everything a page can show.
      revalidatePath("/", "layout");
    }

    return {
      status: "success",
      message: commit
        ? `Imported ${report.imported} row${report.imported === 1 ? "" : "s"}.`
        : `Preview only — nothing has been saved.`,
      report,
    };
  } catch (error) {
    return {
      status: "error",
      message: refusal(error, "The import could not be completed."),
    };
  }
}

/**
 * Exports one sheet as CSV text.
 *
 * The CSV comes back through the action rather than from a route handler so it
 * passes the same permission check as everything else, and so the browser gets
 * it without a second authenticated request. The client turns it into a
 * download.
 */
export async function exportCsvAction(
  _prevState: ExportActionState,
  formData: FormData,
): Promise<ExportActionState> {
  try {
    const ctx = await requirePermission("data:export");

    const parsed = exportRequestSchema.safeParse({
      sheet: formData.get("sheet") ?? "",
    });
    if (!parsed.success) {
      return { status: "error", message: "Unknown data set." };
    }

    const result = await exportSheet(ctx, parsed.data.sheet as LegacySheet);

    return {
      status: "success",
      message: `${result.rowCount} row${result.rowCount === 1 ? "" : "s"} exported.`,
      filename: result.filename,
      csv: result.csv,
      rowCount: result.rowCount,
    };
  } catch (error) {
    return {
      status: "error",
      message: refusal(error, "The export could not be completed."),
    };
  }
}
