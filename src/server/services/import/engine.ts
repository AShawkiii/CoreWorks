import { prisma } from "@/lib/db";
import { cell, mapHeaders, parseCsv } from "@/lib/domain/csv";
import { parseDisplayId } from "@/lib/domain/ids";
import {
  IMPORT_PREREQUISITES,
  LEGACY_HEADERS,
  REQUIRED_COLUMNS,
  SHEET_LABELS,
  type LegacySheet,
} from "@/lib/domain/legacy-schema";
import type { OrgContext } from "@/server/context";
import { ensureSequenceAtLeast } from "@/server/services/ids";

import type {
  Db,
  ImportAdapter,
  ImportReport,
  Lookups,
  RowResult,
  UnmatchedReference,
} from "./types";
import { emptyReport } from "./types";

/**
 * The CSV import engine (migration-plan §4).
 *
 * ```
 * Upload → Parse → Map headers → Validate → Preview → Confirm → Import → Report
 * ```
 *
 * Four rules from the plan shape this file, and each is implemented once here
 * rather than in eleven adapters:
 *
 *  1. **Nothing is written until Confirm, and preview is a dry run over the
 *     real validators.** Both passes execute the *same* code inside a
 *     transaction; the preview rolls it back. That is stronger than a
 *     validate-only path, which can only check what someone remembered to
 *     re-implement — this exercises the real inserts, the real foreign keys,
 *     and the real unique constraints.
 *  2. **Per-row validation, not fail-fast.** One bad row does not abort the
 *     file.
 *  3. **Every row lands in exactly one bucket.** The loop has no path that
 *     leaves a row uncounted, and `assertBucketsSumToTotal` proves it.
 *  4. **Whole file in one transaction.** A partial import would leave a
 *     half-migrated state that is worse than no import at all.
 */

/** How many per-row results to keep. A 50,000-row file must not be held in memory. */
const MAX_REPORTED_ROWS = 500;

/**
 * Runs one row's insert inside a SAVEPOINT.
 *
 * **This is what makes rules 2 and 4 hold at the same time.** PostgreSQL
 * aborts the whole transaction on any error: after a single failed statement
 * every subsequent command returns `25P02 current transaction is aborted`. So
 * a naive "catch the error and carry on" loop inside one transaction does not
 * skip one bad row — it fails every row after it, with a message that names
 * neither the data nor the problem.
 *
 * A savepoint per row gives per-row isolation *within* the single file-level
 * transaction, so both rules are satisfied rather than traded off:
 *
 *  - rule 2 — one bad row does not abort the file;
 *  - rule 4 — the whole file is still one transaction, and a preview still
 *    rolls the entire thing back.
 *
 * The identifier is built from a counter, never from data, so it cannot carry
 * anything into the SQL.
 */
async function withSavepoint(
  tx: Db,
  index: number,
  run: () => Promise<void>,
): Promise<void> {
  const name = `cw_row_${index}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    await run();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}

/** Rolls the preview back without reporting a failure. */
class DryRunRollback extends Error {
  constructor(readonly report: ImportReport) {
    super("dry run");
    this.name = "DryRunRollback";
  }
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Loads every lookup table once.
 *
 * Names are keyed lowercased because legacy joined on display name and a
 * spreadsheet's capitalisation is not stable (audit D4). Where two records
 * share a name the FIRST is kept and the collision is not silently preferred
 * away — see `resolveName`, which reports an ambiguous match as unmatched
 * rather than guessing.
 */
export async function loadLookups(
  ctx: OrgContext,
  db: Db = prisma,
): Promise<Lookups> {
  const [members, clients, packages, services] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        jobTitle: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, displayId: true },
    }),
    db.servicePackage.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.service.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);

  const put = <V>(map: Map<string, V>, key: string | null, value: V) => {
    if (!key) return;
    const normalised = key.trim().toLowerCase();
    if (normalised === "") return;
    if (!map.has(normalised)) map.set(normalised, value);
  };

  const lookups: Lookups = {
    membersByName: new Map(),
    membersByEmail: new Map(),
    membersByJobTitle: new Map(),
    clientsByName: new Map(),
    clientsByDisplayId: new Map(),
    clientDisplayIds: new Map(),
    packagesByName: new Map(),
    servicesByName: new Map(),
  };

  for (const member of members) {
    put(lookups.membersByName, member.user.name, member.id);
    put(lookups.membersByEmail, member.user.email, member.id);
    put(lookups.membersByJobTitle, member.jobTitle, member.id);
  }
  for (const client of clients) {
    put(lookups.clientsByName, client.name, client.id);
    lookups.clientsByDisplayId.set(client.displayId, client.id);
    lookups.clientDisplayIds.set(client.id, client.displayId);
  }
  for (const pkg of packages) put(lookups.packagesByName, pkg.name, pkg.id);
  for (const service of services) put(lookups.servicesByName, service.name, service.id);

  return lookups;
}

/**
 * Checks that a sheet's prerequisites have data (migration-plan §3.3).
 *
 * > *"Referential integrity requires this sequence. The importer enforces it
 * > and refuses out-of-order files."*
 *
 * Refusing the file is much kinder than letting it through: a `TASKS` import
 * run before `CLIENTS` would reject every single row for an unresolvable
 * client, which reads as corrupt data rather than as a sequencing mistake.
 */
export async function checkPrerequisites(
  ctx: OrgContext,
  sheet: LegacySheet,
  db: Db = prisma,
): Promise<string | null> {
  const missing: string[] = [];

  for (const prerequisite of IMPORT_PREREQUISITES[sheet]) {
    const count = await countFor(ctx, prerequisite, db);
    if (count === 0) missing.push(SHEET_LABELS[prerequisite]);
  }

  if (missing.length === 0) return null;

  return `Import ${missing.join(" and ")} first — ${SHEET_LABELS[sheet]} references them by name, so every row would fail.`;
}

async function countFor(
  ctx: OrgContext,
  sheet: LegacySheet,
  db: Db,
): Promise<number> {
  const where = { organizationId: ctx.organizationId, deletedAt: null };

  switch (sheet) {
    case "EMPLOYEES":
      return db.organizationMember.count({ where });
    case "SERVICES":
      return db.service.count({ where });
    case "SERVICE_PACKAGES":
      return db.servicePackage.count({ where });
    case "TASK_TEMPLATES":
      return db.taskTemplate.count({ where });
    case "CLIENTS":
      return db.client.count({ where });
    default:
      // Nothing else is ever a prerequisite; returning 1 keeps the check
      // total without pretending to know a count it never asks for.
      return 1;
  }
}

/** Merges duplicate unmatched-name reports into one line each with a count. */
function mergeUnmatched(
  collected: UnmatchedReference[],
): UnmatchedReference[] {
  const index = new Map<string, UnmatchedReference>();

  for (const entry of collected) {
    const key = `${entry.column}|${entry.value.toLowerCase()}`;
    const existing = index.get(key);
    if (existing) existing.occurrences += entry.occurrences;
    else index.set(key, { ...entry });
  }

  return [...index.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.value.localeCompare(b.value),
  );
}

export interface RunOptions {
  /** True to validate and roll back; false to commit. */
  dryRun: boolean;
}

/**
 * Runs one sheet's import.
 *
 * Both passes are identical apart from the rollback, which is the point: a
 * preview that took a different path would be a different thing from the
 * import it claims to preview.
 */
export async function runImport<T>(
  ctx: OrgContext,
  adapter: ImportAdapter<T>,
  csvText: string,
  options: RunOptions,
): Promise<ImportReport> {
  const { sheet } = adapter;
  const expected = LEGACY_HEADERS[sheet] as readonly string[];

  const parsed = parseCsv(csvText);
  if (parsed.headers.length === 0) {
    return emptyReport(sheet, options.dryRun, "The file is empty.");
  }

  const columns = mapHeaders(parsed.headers, expected);

  // A file missing an identifying column cannot be mapped at all, so it is
  // refused whole rather than rejecting every row with the same reason.
  const missingColumns = REQUIRED_COLUMNS[sheet].filter(
    (header) => (columns[header] ?? -1) < 0,
  );
  if (missingColumns.length > 0) {
    return emptyReport(
      sheet,
      options.dryRun,
      `This does not look like a ${SHEET_LABELS[sheet]} export — missing column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}.`,
    );
  }

  const prerequisite = await checkPrerequisites(ctx, sheet, prisma);
  if (prerequisite) return emptyReport(sheet, options.dryRun, prerequisite);

  if (parsed.rows.length === 0) {
    const report = emptyReport(sheet, options.dryRun);
    report.fatal = "The file has headers but no rows.";
    return report;
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const report = await importRows(ctx, adapter, parsed, columns, tx, options);
        if (options.dryRun) throw new DryRunRollback(report);
        return report;
      },
      // A migration file is large and every row is a write. The defaults
      // (5s) abort a real import halfway, which rule 4 exists to prevent.
      { maxWait: 30_000, timeout: 600_000 },
    );
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

async function importRows<T>(
  ctx: OrgContext,
  adapter: ImportAdapter<T>,
  parsed: ReturnType<typeof parseCsv>,
  columns: Record<string, number>,
  tx: Db,
  options: RunOptions,
): Promise<ImportReport> {
  const report = emptyReport(adapter.sheet, options.dryRun);
  report.total = parsed.rows.length;

  const lookups = await loadLookups(ctx, tx);
  const seenKeys = await adapter.existingKeys(ctx, tx);
  const unmatched: UnmatchedReference[] = [];

  let highestSuffix = 0;

  const record = (result: RowResult) => {
    if (report.rows.length < MAX_REPORTED_ROWS) report.rows.push(result);
  };

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index] as string[];
    const line = parsed.lineNumbers[index] ?? index + 2;
    const read = (header: string) => cell(row, columns, header);

    const displayId =
      adapter.idColumn !== undefined ? read(adapter.idColumn) : "";

    // Sequence continuity (§3.5): track the highest suffix seen in the FILE,
    // including on rows that are skipped as duplicates — the id is taken
    // either way, so the counter must clear it regardless.
    if (adapter.idEntity && displayId) {
      const suffix = parseDisplayId(adapter.idEntity, displayId);
      if (suffix !== null && suffix > highestSuffix) highestSuffix = suffix;
    }

    let outcome;
    try {
      outcome = adapter.parse(read, lookups);
    } catch (error) {
      // An adapter throwing is a bug, but one row's bug must not abort the
      // file — rule 2. It is reported as a failed row with the message.
      report.failed += 1;
      record({
        line,
        outcome: "failed",
        displayId: displayId || null,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (outcome.warnings) unmatched.push(...outcome.warnings);

    if (!outcome.ok) {
      report.failed += 1;
      record({
        line,
        outcome: "failed",
        displayId: displayId || null,
        reason: outcome.reason,
      });
      continue;
    }

    const key = adapter.dedupeKey(outcome.value);
    if (key !== null && seenKeys.has(key)) {
      report.skipped += 1;
      record({
        line,
        outcome: "skipped",
        displayId: displayId || null,
        label: adapter.label(outcome.value),
        reason: "Already present — matched an existing record.",
      });
      continue;
    }

    try {
      // Savepointed: a constraint violation rolls back this row alone, so the
      // rows after it still import. See withSavepoint.
      await withSavepoint(tx, index, () => adapter.insert(ctx, tx, outcome.value));
    } catch (error) {
      // A constraint the adapter did not anticipate. Reported per row rather
      // than aborting, which is what makes the preview useful: the operator
      // sees all of them at once instead of one per re-run.
      report.failed += 1;
      record({
        line,
        outcome: "failed",
        displayId: displayId || null,
        label: adapter.label(outcome.value),
        reason: databaseReason(error),
      });
      continue;
    }

    // Added AFTER the insert succeeds, so a failed row does not make a later
    // identical row look like a duplicate of something that was never written.
    if (key !== null) seenKeys.add(key);

    report.imported += 1;
    record({
      line,
      outcome: "imported",
      displayId: displayId || null,
      label: adapter.label(outcome.value),
    });
  }

  if (adapter.idEntity && highestSuffix > 0) {
    await ensureSequenceAtLeast(
      ctx.organizationId,
      adapter.idEntity,
      highestSuffix,
      tx,
    );
    report.sequences[adapter.idEntity] = highestSuffix;
  }

  report.unmatched = mergeUnmatched(unmatched);
  assertBucketsSumToTotal(report);

  return report;
}

/**
 * Turns a database error into something an operator can act on.
 *
 * Prisma's own message names the constraint and, in development, the query —
 * neither of which belongs in an import report a non-engineer reads.
 */
function databaseReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;

  if (code === "P2002") return "A record with these values already exists.";
  if (code === "P2003") return "Refers to a record that does not exist.";
  if (code === "P2000") return "A value is too long for its column.";

  console.error("[import] unexpected database error", error);
  return "Could not be saved.";
}

/**
 * Rule 3, enforced rather than assumed.
 *
 * A row that fell through every branch would vanish from a summary that still
 * looked plausible — the worst failure mode available to a data migration, so
 * it is checked in production and not only in tests.
 */
export function assertBucketsSumToTotal(report: ImportReport): void {
  const sum = report.imported + report.skipped + report.failed;
  if (sum !== report.total) {
    throw new ImportError(
      `Import accounting is wrong: ${sum} rows bucketed but ${report.total} read. Nothing has been saved.`,
    );
  }
}
