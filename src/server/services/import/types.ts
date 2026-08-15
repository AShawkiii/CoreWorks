import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/db";
import type { IdEntity } from "@/lib/domain/ids";
import type { LegacySheet } from "@/lib/domain/legacy-schema";
import type { OrgContext } from "@/server/context";

/**
 * Shapes for the CSV import engine (migration-plan §4).
 *
 * The rule that drives every type here:
 *
 * > *"Every row lands in exactly one bucket — Imported / Skipped (duplicate) /
 * > Failed (with reason + row number)."*
 *
 * `RowOutcome` is therefore a closed union of exactly three states, and the
 * report carries counts that a test asserts sum to the row total. A row that
 * fell through every branch would be invisible in a summary that still looked
 * plausible, which is the worst possible failure mode for a data migration.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export type RowOutcome = "imported" | "skipped" | "failed";

export interface RowResult {
  /** 1-based line in the original file — what the operator has to go and look at. */
  line: number;
  outcome: RowOutcome;
  /** The legacy display ID, when the row had one, for cross-referencing. */
  displayId?: string | null;
  /** A short identifier for the record: client name, task name, and so on. */
  label?: string | null;
  /** Why it was skipped or failed. Always present unless imported. */
  reason?: string;
}

/**
 * An unmatched name-based reference (migration-plan §3.4).
 *
 * > *"Unmatched names are listed individually in the import report — never
 * > silently dropped."*
 *
 * Collected even when the row still imports, because "imported with the
 * assignee dropped" is something the operator must see.
 */
export interface UnmatchedReference {
  column: string;
  value: string;
  /** How many rows referenced this same missing name. */
  occurrences: number;
  /** Whether the rows survived or were rejected. */
  action: "rejected" | "left blank" | "kept as text";
}

export interface ImportReport {
  sheet: LegacySheet;
  /** True when nothing was written — the preview pass. */
  dryRun: boolean;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  rows: RowResult[];
  unmatched: UnmatchedReference[];
  /** File-level problems: a missing required column, a missing prerequisite. */
  fatal: string | null;
  /** Display-ID sequences raised so new records continue the series (§3.5). */
  sequences: Partial<Record<IdEntity, number>>;
}

export function emptyReport(
  sheet: LegacySheet,
  dryRun: boolean,
  fatal: string | null = null,
): ImportReport {
  return {
    sheet,
    dryRun,
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    rows: [],
    unmatched: [],
    fatal,
    sequences: {},
  };
}

/** What a row parser produces. */
export type ParseResult<T> =
  | { ok: true; value: T; warnings?: UnmatchedReference[] }
  | { ok: false; reason: string; warnings?: UnmatchedReference[] };

/**
 * Everything an adapter needs that must be loaded once per run rather than per
 * row.
 *
 * A thousand-row TASKS file resolving `Assigned To` per row would issue a
 * thousand queries; these maps make it one per lookup table.
 */
export interface Lookups {
  /** Lowercased user name → OrganizationMember id. */
  membersByName: Map<string, string>;
  /** Lowercased user email → OrganizationMember id. */
  membersByEmail: Map<string, string>;
  /** Lowercased client name → Client id. */
  clientsByName: Map<string, string>;
  /** Client displayId → Client id. */
  clientsByDisplayId: Map<string, string>;
  /** Client id → displayId, for building composite close ids. */
  clientDisplayIds: Map<string, string>;
  /** Lowercased package name → ServicePackage id. */
  packagesByName: Map<string, string>;
  /** Lowercased service name → Service id. */
  servicesByName: Map<string, string>;
  /** Lowercased job title → OrganizationMember id, for template assignees. */
  membersByJobTitle: Map<string, string>;
}

/**
 * A per-entity adapter.
 *
 * Deliberately small: the engine owns parsing, bucketing, transactions, the
 * report, and sequence continuity, so an adapter only describes what is
 * specific to its sheet. Adding a twelfth entity should not mean re-deriving
 * any of that.
 */
export interface ImportAdapter<T> {
  sheet: LegacySheet;
  /** The display-ID entity, when the sheet has one, for §3.5 continuity. */
  idEntity?: IdEntity;
  /** The legacy column holding that display ID. */
  idColumn?: string;

  /** Turns one CSV row into a value, or a reason it cannot be one. */
  parse(
    read: (header: string) => string,
    lookups: Lookups,
  ): ParseResult<T>;

  /**
   * The idempotency key (migration-plan §4).
   *
   * > *"Duplicate detection reuses legacy rules ... The importer is
   * > idempotent: re-running a file imports nothing new."*
   *
   * Null means the row cannot be deduplicated and is always inserted.
   */
  dedupeKey(value: T): string | null;

  /** Keys already present in the organization, loaded once. */
  existingKeys(ctx: OrgContext, db: Db): Promise<Set<string>>;

  /** Writes one row. The engine supplies the transaction. */
  insert(ctx: OrgContext, db: Db, value: T): Promise<void>;

  /** A short human label for the report. */
  label(value: T): string;
}
