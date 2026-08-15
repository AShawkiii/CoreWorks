"use client";

import { Download, Loader2, Upload } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  IMPORT_ORDER,
  LEGACY_HEADERS,
  SHEET_LABELS,
  type LegacySheet,
} from "@/lib/domain/legacy-schema";
import {
  exportCsvAction,
  importCsvAction,
  type ExportActionState,
  type ImportActionState,
} from "@/server/actions/data-transfer";

function Submitting({ label, pending }: { label: string; pending: boolean }) {
  return pending ? (
    <>
      <Loader2 className="animate-spin" aria-hidden="true" />
      {label}
    </>
  ) : null;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function ImportButtons() {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        Two submit buttons on one form, distinguished by the `commit` value
        they carry. The preview is first and is the default action, so pressing
        Enter in the file field cannot commit an import by accident.
      */}
      <Button type="submit" name="commit" value="false" disabled={pending}>
        <Submitting label="Checking…" pending={pending} />
        {pending ? null : (
          <>
            <Upload aria-hidden="true" />
            Preview
          </>
        )}
      </Button>
      <Button
        type="submit"
        name="commit"
        value="true"
        variant="outline"
        disabled={pending}
      >
        Import for real
      </Button>
    </div>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState<ImportActionState, FormData>(
    importCsvAction,
    {},
  );
  const [sheet, setSheet] = useState<LegacySheet>("EMPLOYEES");

  const report = state.report;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-sheet">Data set</Label>
          <Select
            id="import-sheet"
            name="sheet"
            value={sheet}
            onChange={(event) => setSheet(event.target.value as LegacySheet)}
          >
            {IMPORT_ORDER.map((entry, index) => (
              <option key={entry} value={entry}>
                {index + 1}. {SHEET_LABELS[entry]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Import in this order — later sets reference earlier ones by name.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-file">CSV file</Label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
          />
          <p className="text-xs text-muted-foreground">
            An unmodified Sheets export. Headers are matched exactly.
          </p>
        </div>
      </div>

      <details className="rounded-md border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          Expected columns for {SHEET_LABELS[sheet]}
        </summary>
        <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {(LEGACY_HEADERS[sheet] as readonly string[]).join(" · ")}
        </p>
      </details>

      <ImportButtons />

      {report ? <ImportReportView report={report} /> : null}
    </form>
  );
}

function ImportReportView({
  report,
}: {
  report: NonNullable<ImportActionState["report"]>;
}) {
  const buckets = [
    { label: "Imported", value: report.imported, variant: "success" as const },
    { label: "Skipped", value: report.skipped, variant: "neutral" as const },
    { label: "Failed", value: report.failed, variant: "danger" as const },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {report.dryRun ? "Preview" : "Result"} · {report.total} row
          {report.total === 1 ? "" : "s"} read
        </span>
        {buckets.map((bucket) => (
          <Badge key={bucket.label} variant={bucket.variant}>
            {bucket.label}: {bucket.value}
          </Badge>
        ))}
      </div>

      {report.dryRun ? (
        <p className="text-xs text-muted-foreground">
          Nothing has been saved. This ran the real validators and the real
          database constraints inside a transaction, then rolled it back.
        </p>
      ) : null}

      {Object.keys(report.sequences).length > 0 ? (
        <p className="text-xs text-muted-foreground">
          ID numbering continued from the imported records, so new ones will not
          collide.
        </p>
      ) : null}

      {report.unmatched.length > 0 ? (
        <div>
          <p className="text-sm font-medium">Names that did not match</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {report.unmatched.map((entry) => (
              <li key={`${entry.column}|${entry.value}`}>
                <span className="font-medium">{entry.column}:</span>{" "}
                &ldquo;{entry.value}&rdquo; ×{entry.occurrences} —{" "}
                {entry.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.rows.some((row) => row.outcome !== "imported") ? (
        <div>
          <p className="text-sm font-medium">Rows needing attention</p>
          <ul className="mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto text-xs">
            {report.rows
              .filter((row) => row.outcome !== "imported")
              .map((row) => (
                <li key={`${row.line}-${row.outcome}`}>
                  <span
                    className={
                      row.outcome === "failed"
                        ? "font-medium text-danger"
                        : "font-medium text-muted-foreground"
                    }
                  >
                    Line {row.line}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {row.displayId ? `${row.displayId} — ` : ""}
                    {row.reason}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Submitting label="Building…" pending={pending} />
      {pending ? null : (
        <>
          <Download aria-hidden="true" />
          Export CSV
        </>
      )}
    </Button>
  );
}

export function ExportForm({
  counts,
}: {
  counts: Record<LegacySheet, number>;
}) {
  const [state, formAction] = useActionState<ExportActionState, FormData>(
    exportCsvAction,
    {},
  );

  /*
   * The CSV arrives as text in the action result; this turns it into a file.
   *
   * Done here rather than by linking to a route handler so the download passes
   * the same permission check as every other action, and so the browser does
   * not make a second authenticated request for data it has already been given.
   */
  useEffect(() => {
    if (!state.csv || !state.filename) return;

    /*
     * Re-attach the byte-order mark.
     *
     * `toCsv` writes one, but React's flight serialization strips a LEADING
     * U+FEFF from a string in transit — it is a zero-width no-break space, and
     * the payload arrives at the browser without it. Verified in a real
     * browser: the string the client receives starts at "C", not the BOM.
     *
     * That matters rather than being cosmetic: the BOM is the only reason
     * Excel reads a UTF-8 CSV as UTF-8 instead of the local 8-bit codepage,
     * and client names in this data legitimately contain non-ASCII characters.
     *
     * Guarded so it cannot double up if a future runtime stops stripping it.
     */
    const withBom = state.csv.startsWith("\uFEFF")
      ? state.csv
      : `\uFEFF${state.csv}`;

    const blob = new Blob([withBom], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = state.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [state.csv, state.filename]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="export-sheet">Data set</Label>
        <Select id="export-sheet" name="sheet" defaultValue="CLIENTS">
          {IMPORT_ORDER.map((entry) => (
            <option key={entry} value={entry}>
              {SHEET_LABELS[entry]} ({counts[entry]})
            </option>
          ))}
        </Select>
      </div>

      <div>
        <ExportButton />
      </div>
    </form>
  );
}
