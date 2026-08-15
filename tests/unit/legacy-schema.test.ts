import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import {
  DERIVED_COLUMNS,
  IMPORT_ORDER,
  IMPORT_PREREQUISITES,
  LEGACY_HEADERS,
  REQUIRED_COLUMNS,
  SHEET_LABELS,
  isDerivedColumn,
  isLegacySheet,
  type LegacySheet,
} from "@/lib/domain/legacy-schema";

/**
 * The import contract, checked against the legacy source rather than against
 * a transcription of it.
 *
 * Migration-plan §3.2 makes the exact legacy header strings the contract:
 * *"the importer matches on the exact legacy header string, so an unmodified
 * export works with no hand-editing."* A tidy-up here — dropping the question
 * mark from `Active?`, say — would break every future import while every other
 * test kept passing. So this suite parses `legacy/apps-script/config/Schemas.gs`
 * and compares.
 *
 * `/legacy` is never executed; this only reads it as text.
 */

const SCHEMAS_PATH = join(
  process.cwd(),
  "legacy",
  "apps-script",
  "config",
  "Schemas.gs",
);

/**
 * Extracts one header array from the legacy file.
 *
 * Parsed with a regex rather than by evaluating the file: `Schemas.gs` is
 * Apps Script reference material, and this repository does not run it.
 */
function legacyHeaders(sheet: string): string[] {
  const source = readFileSync(SCHEMAS_PATH, "utf8");
  const match = new RegExp(`\\b${sheet}:\\s*\\[([\\s\\S]*?)\\]`, "m").exec(
    source,
  );
  if (!match) throw new Error(`No ${sheet} block found in Schemas.gs`);

  return [...(match[1] as string).matchAll(/'([^']*)'/g)].map(
    (m) => m[1] as string,
  );
}

describe("LEGACY_HEADERS matches legacy/config/Schemas.gs", () => {
  const sheets = Object.keys(LEGACY_HEADERS) as LegacySheet[];

  it("covers every data sheet legacy declares", () => {
    const source = readFileSync(SCHEMAS_PATH, "utf8");
    const declared = [...source.matchAll(/^\s{2}([A-Z_]+):\s*\[/gm)].map(
      (m) => m[1] as string,
    );

    expect(new Set(declared)).toEqual(new Set(sheets));
  });

  for (const sheet of Object.keys(LEGACY_HEADERS) as LegacySheet[]) {
    it(`${sheet} — exact strings and column order`, () => {
      expect([...LEGACY_HEADERS[sheet]]).toEqual(legacyHeaders(sheet));
    });
  }

  it("keeps the awkward spellings that are part of the contract", () => {
    // Each of these is the kind of string a well-meaning edit would "fix".
    expect(LEGACY_HEADERS.EMPLOYEES).toContain("Active?");
    expect(LEGACY_HEADERS.TASK_TEMPLATES).toContain("Typical Duration (Days)");
    expect(LEGACY_HEADERS.TASK_TEMPLATES).toContain("Required Client Input?");
    expect(LEGACY_HEADERS.CLIENTS).toContain("Month-End Closing Date");
    expect(LEGACY_HEADERS.CLIENT_REQUESTS).toContain("Days Waiting Bucket");
    expect(LEGACY_HEADERS.MONTHLY_CLOSE).toContain("P&L");
  });

  it("does not declare the dashboard sheets", () => {
    // Rendered views, not data (migration-plan §3.1). CoreWorks regenerates
    // all of them, and importing one would create records from a report.
    for (const view of [
      "CONTROL_CENTER",
      "CLIENT_DASHBOARD",
      "TEAM_DASHBOARD",
      "MONTHLY_CLOSE_DASHBOARD",
      "MANAGEMENT_REPORT",
      "_CHART_SRC",
    ]) {
      expect(isLegacySheet(view), view).toBe(false);
    }
  });
});

describe("MONTHLY_CLOSE stage columns", () => {
  it("places the 18 stages at columns 4-21, as slice(3, 21) does", () => {
    // Legacy: MONTHLY_CLOSE_STAGE_COLUMNS = SCHEMAS.MONTHLY_CLOSE.slice(3, 21)
    expect(LEGACY_HEADERS.MONTHLY_CLOSE.slice(3, 21)).toEqual([
      ...MONTHLY_CLOSE_STAGES,
    ]);
    expect(MONTHLY_CLOSE_STAGES).toHaveLength(18);
  });

  it("matches the slice the legacy file itself computes", () => {
    expect(legacyHeaders("MONTHLY_CLOSE").slice(3, 21)).toEqual([
      ...MONTHLY_CLOSE_STAGES,
    ]);
  });

  it("brackets the stages with the identity columns and the derived pair", () => {
    expect(LEGACY_HEADERS.MONTHLY_CLOSE.slice(0, 3)).toEqual([
      "Close ID",
      "Client",
      "Month",
    ]);
    expect(LEGACY_HEADERS.MONTHLY_CLOSE.slice(21)).toEqual([
      "Close Status",
      "Completion %",
    ]);
  });
});

describe("DERIVED_COLUMNS", () => {
  it("names only columns that exist on their sheet", () => {
    for (const [sheet, columns] of Object.entries(DERIVED_COLUMNS)) {
      for (const column of columns ?? []) {
        expect(
          (LEGACY_HEADERS[sheet as LegacySheet] as readonly string[]).includes(
            column,
          ),
          `${sheet}.${column}`,
        ).toBe(true);
      }
    }
  });

  it("covers exactly the list in migration-plan §3.2", () => {
    expect(isDerivedColumn("CLIENTS", "Client Health")).toBe(true);
    expect(isDerivedColumn("CLIENTS", "Simple Completion %")).toBe(true);
    expect(isDerivedColumn("CLIENTS", "Weighted Completion %")).toBe(true);
    expect(isDerivedColumn("CLIENTS", "Last Activity")).toBe(true);
    expect(isDerivedColumn("CLIENTS", "Next Deadline")).toBe(true);
    expect(isDerivedColumn("TASKS", "Days Remaining")).toBe(true);
    expect(isDerivedColumn("TASKS", "Days Overdue")).toBe(true);
    expect(isDerivedColumn("CLIENT_REQUESTS", "Days Waiting")).toBe(true);
    expect(isDerivedColumn("CLIENT_REQUESTS", "Days Waiting Bucket")).toBe(true);
    expect(isDerivedColumn("MONTHLY_CLOSE", "Close Status")).toBe(true);
    expect(isDerivedColumn("MONTHLY_CLOSE", "Completion %")).toBe(true);
  });

  it("does NOT treat a stored, non-derived column as derived", () => {
    // Task Completion % is stored per task in legacy, unlike the client-level
    // rollups. Treating it as derived would silently discard real data.
    expect(isDerivedColumn("TASKS", "Completion %")).toBe(false);
    expect(isDerivedColumn("CLIENTS", "Contract Status")).toBe(false);
    expect(isDerivedColumn("TASKS", "Status")).toBe(false);
  });
});

describe("IMPORT_ORDER", () => {
  it("is exactly the sequence migration-plan §3.1/§3.3 specifies", () => {
    expect([...IMPORT_ORDER]).toEqual([
      "EMPLOYEES",
      "SERVICES",
      "SERVICE_PACKAGES",
      "TASK_TEMPLATES",
      "CLIENTS",
      "TASKS",
      "CLIENT_REQUESTS",
      "ISSUES",
      "MONTHLY_CLOSE",
      "ACTIVITY_LOG",
      "SETTINGS",
    ]);
  });

  it("lists every sheet exactly once", () => {
    expect(new Set(IMPORT_ORDER)).toEqual(
      new Set(Object.keys(LEGACY_HEADERS)),
    );
    expect(IMPORT_ORDER).toHaveLength(Object.keys(LEGACY_HEADERS).length);
  });

  it("places every prerequisite strictly before its dependant", () => {
    // The property the order exists for. Stated separately from the literal
    // sequence above so a future reordering has to satisfy the rule, not just
    // match a list.
    for (const [sheet, prerequisites] of Object.entries(IMPORT_PREREQUISITES)) {
      const position = IMPORT_ORDER.indexOf(sheet as LegacySheet);
      for (const prerequisite of prerequisites) {
        expect(
          IMPORT_ORDER.indexOf(prerequisite),
          `${prerequisite} must precede ${sheet}`,
        ).toBeLessThan(position);
      }
    }
  });

  it("has no cycles and names only real sheets", () => {
    for (const [sheet, prerequisites] of Object.entries(IMPORT_PREREQUISITES)) {
      for (const prerequisite of prerequisites) {
        expect(isLegacySheet(prerequisite), prerequisite).toBe(true);
        expect(
          IMPORT_PREREQUISITES[prerequisite].includes(sheet as LegacySheet),
          `${sheet} <-> ${prerequisite} is a cycle`,
        ).toBe(false);
      }
    }
  });
});

describe("REQUIRED_COLUMNS and SHEET_LABELS", () => {
  it("names only columns that exist on their sheet", () => {
    for (const [sheet, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const column of columns) {
        expect(
          (LEGACY_HEADERS[sheet as LegacySheet] as readonly string[]).includes(
            column,
          ),
          `${sheet}.${column}`,
        ).toBe(true);
      }
    }
  });

  it("never requires a derived column", () => {
    // Requiring one would reject a file that correctly omitted it.
    for (const [sheet, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const column of columns) {
        expect(
          isDerivedColumn(sheet as LegacySheet, column),
          `${sheet}.${column} is derived and cannot be required`,
        ).toBe(false);
      }
    }
  });

  it("labels every sheet", () => {
    for (const sheet of Object.keys(LEGACY_HEADERS) as LegacySheet[]) {
      expect(SHEET_LABELS[sheet], sheet).toBeTruthy();
    }
  });
});
