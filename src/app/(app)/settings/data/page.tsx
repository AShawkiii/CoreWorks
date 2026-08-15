import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IMPORT_ORDER, SHEET_LABELS } from "@/lib/domain/legacy-schema";
import { hasPermission } from "@/server/auth/permissions";
import { getExportCounts } from "@/server/services/export";
import { getOrgContext } from "@/server/tenancy";

import { ExportForm, ImportForm } from "./data-forms";

export const metadata: Metadata = {
  title: "Import & export",
};

export default async function DataSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const canImport = hasPermission(ctx.role, "data:import");
  const canExport = hasPermission(ctx.role, "data:export");
  // A Viewer holds neither and has nothing to do here.
  if (!canImport && !canExport) notFound();

  const counts = canExport
    ? await getExportCounts(ctx)
    : null;

  return (
    <div className="flex flex-col gap-6">
      {canImport ? (
        <Card>
          <CardHeader>
            <CardTitle>Import from CSV</CardTitle>
            <CardDescription>
              Upload an unmodified export from the previous Sheets system.
              Columns are matched on their original header names, so nothing
              needs hand-editing first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportForm />
          </CardContent>
        </Card>
      ) : null}

      {canExport && counts ? (
        <Card>
          <CardHeader>
            <CardTitle>Export to CSV</CardTitle>
            <CardDescription>
              Every data set, with the original column headers — so a file can
              go straight back into a spreadsheet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportForm counts={counts} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How an import behaves</CardTitle>
          <CardDescription>
            The rules that make a migration safe to attempt more than once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              Nothing is written until you confirm.
            </span>{" "}
            Preview runs the real validators and the real database constraints
            inside a transaction, then rolls it back — so what it reports is
            what an import would actually do, not a separate guess at it.
          </p>
          <p>
            <span className="font-medium text-foreground">
              One bad row does not stop the file.
            </span>{" "}
            Every row lands in exactly one of Imported, Skipped, or Failed, and
            a failure names the line number and the reason.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Re-running a file imports nothing new.
            </span>{" "}
            Duplicates are detected with the same rules the old system used —
            clients on name and company, tasks on client, service area, task
            name, and period.
          </p>
          <p>
            <span className="font-medium text-foreground">
              The whole file is one transaction.
            </span>{" "}
            An import either lands completely or not at all; there is no
            half-migrated state to unpick.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Calculated columns are not imported.
            </span>{" "}
            Client health, the completion percentages, days overdue, days
            waiting, and the close totals are recomputed from the underlying
            records. A spreadsheet figure that disagrees with the recomputed one
            is worth investigating rather than trusting.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Order matters.
            </span>{" "}
            {IMPORT_ORDER.map((sheet) => SHEET_LABELS[sheet]).join(" → ")}. An
            out-of-order file is refused rather than failing row by row.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
