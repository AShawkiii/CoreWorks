import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { parseCsv, toCsv } from "@/lib/domain/csv";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  IMPORT_ORDER,
  LEGACY_HEADERS,
  type LegacySheet,
} from "@/lib/domain/legacy-schema";
import type { OrgContext } from "@/server/context";
import { exportSheet, getExportCounts } from "@/server/services/export";
import { commitImport } from "@/server/services/import";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 13 integration tests — CSV export (migration-plan §6).
 *
 * > *"Every importable entity is also exportable to CSV, using the same legacy
 * > headers. This gives round-tripping, the post-cutover rollback path, and
 * > continuity for staff who still want a spreadsheet."*
 *
 * The round-trip suite at the end is the one that matters most: §5 names
 * export-then-reimport as the rollback path after cutover, so a column that
 * exports in a form the importer will not read back is a broken rollback, not
 * a cosmetic bug.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-export";
const RIVAL_SLUG = "test-org-export-rival";
const EMAIL_DOMAIN = "@export-test.example.com";

let ctx: OrgContext;
let rivalCtx: OrgContext;

function csvFor(sheet: LegacySheet, rows: Record<string, string>[]): string {
  const headers = [...(LEGACY_HEADERS[sheet] as readonly string[])];
  return toCsv(
    headers,
    rows.map((row) => headers.map((header) => row[header] ?? "")),
  );
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, RIVAL_SLUG, `${SLUG}-collide`] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}


async function buildOrg(
  slug: string,
  name: string,
  prefix: string,
  /**
   * The owner's display ID.
   *
   * The rollback target gets one far outside the imported range. Display IDs
   * are user-facing and staff cite them (audit §4), so the importer will not
   * renumber a colliding row — it reports it. A realistic rollback target is a
   * fresh organization whose single admin account does not clash; see the
   * dedicated test below for what happens when it does.
   */
  ownerSequence = 1,
) {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: `${prefix} Owner`,
      email: `${prefix}-owner${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true, name: true, email: true },
  });
  const member = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", ownerSequence),
      role: OrgRole.OWNER,
    },
    select: { id: true },
  });
  await prisma.idSequence.create({
    data: {
      organizationId: org.id,
      entity: "MEMBER",
      lastValue: ownerSequence,
    },
  });

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
    role: OrgRole.OWNER,
  } satisfies OrgContext;
}

/** A full, realistic data set across every entity, loaded through the importer. */
async function seedEverything(target: OrgContext, suffix: string) {
  await commitImport(
    target,
    "EMPLOYEES",
    csvFor("EMPLOYEES", [
      {
        "Employee ID": "EMP-002",
        "Employee Name": "Morgan Reyes",
        Role: "Account Manager",
        Department: "Client Services",
        Email: `morgan-${suffix}${EMAIL_DOMAIN}`,
        "Active?": "Yes",
        Capacity: "12",
        Notes: "Handles the retail book",
      },
      {
        "Employee ID": "EMP-003",
        "Employee Name": "Priya Anand",
        Role: "Bookkeeper",
        Email: `priya-${suffix}${EMAIL_DOMAIN}`,
        "Active?": "No",
        Capacity: "20",
      },
    ]),
  );

  await commitImport(
    target,
    "SERVICES",
    csvFor("SERVICES", [
      {
        "Service ID": "SVC-001",
        "Service Name": "Bookkeeping",
        Category: "Core",
        Description: "Day-to-day ledger work, reconciliations",
        "Active?": "Yes",
      },
      { "Service ID": "SVC-002", "Service Name": "Payroll", "Active?": "Yes" },
    ]),
  );

  await commitImport(
    target,
    "SERVICE_PACKAGES",
    csvFor("SERVICE_PACKAGES", [
      {
        "Package ID": "PKG-001",
        "Package Name": "Basic Accounting",
        Description: "Core bookkeeping",
        "Included Service Areas": "Bookkeeping, Payroll",
        "Active?": "Yes",
      },
    ]),
  );

  await commitImport(
    target,
    "TASK_TEMPLATES",
    csvFor("TASK_TEMPLATES", [
      {
        "Template ID": "TPL-001",
        "Service Package": "Basic Accounting",
        "Service Area": "Bookkeeping",
        "Task Name": "Bank Reconciliation",
        Description: "Reconcile all accounts",
        Frequency: "Monthly",
        Priority: "High",
        "Default Assignee": "Bookkeeper",
        "Typical Duration (Days)": "3",
        "Required Client Input?": "Yes",
        "Active?": "Yes",
      },
    ]),
  );

  await commitImport(
    target,
    "CLIENTS",
    csvFor("CLIENTS", [
      {
        "Client ID": "CL-0007",
        "Client Name": "Brightline Retail Co",
        "Company Name": "Brightline Retail LLC",
        Industry: "Retail",
        "Business Type": "LLC",
        "Start Date": "2025-11-01",
        "Service Package": "Basic Accounting",
        "Account Manager": "Morgan Reyes",
        "Backup Team Member": "Priya Anand",
        "Client Contact": "Alex Brightline",
        Email: "alex@brightline.example",
        Phone: "555-0101",
        "Accounting System": "QuickBooks Online",
        "Reporting Frequency": "Monthly",
        "Month-End Closing Date": "5",
        "Contract Status": "Active",
        Priority: "Medium",
        Notes: "Multi-location retailer, 4 storefronts.",
      },
    ]),
  );

  await commitImport(
    target,
    "TASKS",
    csvFor("TASKS", [
      {
        "Task ID": "TSK-000001",
        "Client ID": "CL-0007",
        "Client Name": "Brightline Retail Co",
        "Service Area": "Bookkeeping",
        "Task Category": "Recurring",
        "Task Name": "Bank Reconciliation",
        Description: 'Reconcile "all" accounts, including petty cash',
        Period: "2026-01",
        Frequency: "Monthly",
        "Assigned To": "Priya Anand",
        Priority: "High",
        Status: "In Progress",
        "Start Date": "2026-01-02",
        "Due Date": "2026-01-15",
        "Waiting For": "Bank statements",
        "Client Dependency": "Yes",
        "Completion %": "0.5",
        Reviewer: "Morgan Reyes",
        "Review Status": "Not Reviewed",
        Notes: "Line one\nline two",
      },
    ]),
  );

  await commitImport(
    target,
    "CLIENT_REQUESTS",
    csvFor("CLIENT_REQUESTS", [
      {
        "Request ID": "REQ-0001",
        "Client ID": "CL-0007",
        Client: "Brightline Retail Co",
        Request: "Send January bank statements",
        "Requested Date": "2026-01-02",
        "Required By": "2026-01-10",
        Status: "Received",
        Priority: "High",
        "Assigned To": "Priya Anand",
        "Received Date": "2026-01-08",
        Notes: "Chased twice",
      },
    ]),
  );

  await commitImport(
    target,
    "ISSUES",
    csvFor("ISSUES", [
      {
        "Issue ID": "ISS-0001",
        "Client ID": "CL-0007",
        Client: "Brightline Retail Co",
        Issue: "Missing Q3 bank statements",
        Category: "Records",
        "Date Raised": "2026-01-05",
        Severity: "Critical",
        "Assigned To": "Morgan Reyes",
        Status: "Open",
        Impact: "Cannot close the quarter",
        "Required Action": "Obtain statements",
        Deadline: "2026-01-20",
        Notes: "Escalated",
      },
    ]),
  );

  const closeRow: Record<string, string> = {
    Client: "Brightline Retail Co",
    Month: "2026-01",
  };
  for (const stage of MONTHLY_CLOSE_STAGES) closeRow[stage] = "Not Started";
  closeRow.Sales = "Completed";
  closeRow["Bank Reconciliation"] = "Blocked";
  closeRow.Payroll = "Waiting Client";
  await commitImport(target, "MONTHLY_CLOSE", csvFor("MONTHLY_CLOSE", [closeRow]));

  await commitImport(
    target,
    "ACTIVITY_LOG",
    csvFor("ACTIVITY_LOG", [
      {
        "Activity ID": "ACT-0000001",
        Date: "2026-01-05",
        User: "Morgan Reyes",
        Client: "Brightline Retail Co",
        "Entity Type": "Client",
        "Entity ID": "CL-0007",
        Action: "Client Added",
        "New Value": "Brightline Retail Co",
        Comment: "Imported, comma inside",
      },
    ]),
  );
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  ctx = await buildOrg(SLUG, "Export Test Org", "primary");
  rivalCtx = await buildOrg(RIVAL_SLUG, "Rival Org", "rival", 900);
  await seedEverything(ctx, "primary");
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("every entity is exportable (§6)", () => {
  for (const sheet of IMPORT_ORDER) {
    it(`${sheet} exports with the exact legacy headers`, async () => {
      const result = await exportSheet(ctx, sheet);
      const parsed = parseCsv(result.csv);

      // The rollback path depends on this: a file whose headers differ is a
      // file the importer — and a legacy sheet — will not read.
      expect(parsed.headers).toEqual([
        ...(LEGACY_HEADERS[sheet] as readonly string[]),
      ]);
    });
  }

  it("writes a BOM so Excel does not mangle non-ASCII", async () => {
    const result = await exportSheet(ctx, "CLIENTS");
    expect(result.csv.startsWith("﻿")).toBe(true);
  });

  it("names the file after the organization and the sheet", async () => {
    const result = await exportSheet(ctx, "CLIENTS");
    expect(result.filename).toBe(`${SLUG}-clients.csv`);
  });

  it("exports headers only when there is nothing to export", async () => {
    const result = await exportSheet(rivalCtx, "CLIENTS");
    expect(result.rowCount).toBe(0);
    expect(parseCsv(result.csv).headers).toEqual([
      ...(LEGACY_HEADERS.CLIENTS as readonly string[]),
    ]);
  });
});

suite("values are written in legacy form", () => {
  it("writes Yes/No, not true/false", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "EMPLOYEES")).csv);
    const active = parsed.headers.indexOf("Active?");

    const values = parsed.rows.map((row) => row[active]);
    expect(values).toContain("Yes");
    expect(values).toContain("No");
    expect(values.some((v) => v === "true" || v === "false")).toBe(false);
  });

  it("writes dates as YYYY-MM-DD", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "CLIENTS")).csv);
    const start = parsed.headers.indexOf("Start Date");
    expect(parsed.rows[0]?.[start]).toBe("2025-11-01");
  });

  it("writes enum LABELS, not enum names", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "TASKS")).csv);
    const status = parsed.headers.indexOf("Status");
    const priority = parsed.headers.indexOf("Priority");

    expect(parsed.rows[0]?.[status]).toBe("In Progress");
    expect(parsed.rows[0]?.[priority]).toBe("High");
    expect(parsed.rows[0]?.[status]).not.toBe("IN_PROGRESS");
  });

  it("quotes commas, quotes, and newlines so they survive", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "TASKS")).csv);
    const description = parsed.headers.indexOf("Description");
    const notes = parsed.headers.indexOf("Notes");

    expect(parsed.rows[0]?.[description]).toBe(
      'Reconcile "all" accounts, including petty cash',
    );
    expect(parsed.rows[0]?.[notes]).toBe("Line one\nline two");
  });

  it("re-flattens a package's services to the legacy free-text cell", async () => {
    // Audit §14.3: legacy held one comma-separated cell; CoreWorks normalises
    // it to a join table. Export puts it back.
    const parsed = parseCsv((await exportSheet(ctx, "SERVICE_PACKAGES")).csv);
    const included = parsed.headers.indexOf("Included Service Areas");
    const cell = parsed.rows[0]?.[included] ?? "";

    expect(cell).toContain("Bookkeeping");
    expect(cell).toContain("Payroll");
  });

  it("turns the 18 close stage ROWS back into 18 COLUMNS", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "MONTHLY_CLOSE")).csv);
    const row = parsed.rows[0] as string[];

    expect(row[parsed.headers.indexOf("Sales")]).toBe("Completed");
    expect(row[parsed.headers.indexOf("Bank Reconciliation")]).toBe("Blocked");
    expect(row[parsed.headers.indexOf("Payroll")]).toBe("Waiting Client");
    expect(row[parsed.headers.indexOf("Inventory")]).toBe("Not Started");
    // The stages sit at columns 4-21, as slice(3, 21) requires.
    expect(parsed.headers.slice(3, 21)).toEqual([...MONTHLY_CLOSE_STAGES]);
  });
});

suite("derived columns ARE exported (§3.2 applies to import only)", () => {
  it("recomputes days remaining and overdue rather than reading a column", async () => {
    // The task is due 2026-01-15. Exported "as of" the date supplied, so the
    // file is correct now rather than as at the last nightly pass.
    const early = parseCsv(
      (await exportSheet(ctx, "TASKS", new Date(Date.UTC(2026, 0, 10)))).csv,
    );
    const late = parseCsv(
      (await exportSheet(ctx, "TASKS", new Date(Date.UTC(2026, 0, 20)))).csv,
    );

    const remaining = early.headers.indexOf("Days Remaining");
    const overdue = early.headers.indexOf("Days Overdue");

    expect(early.rows[0]?.[remaining]).toBe("5");
    expect(early.rows[0]?.[overdue]).toBe("0");
    expect(late.rows[0]?.[overdue]).toBe("5");
  });

  it("recomputes days waiting and its bucket", async () => {
    // Requested 2026-01-02, received 2026-01-08, status Received — so the
    // clock is frozen at 6 days regardless of today (audit §6.4).
    const parsed = parseCsv(
      (await exportSheet(ctx, "CLIENT_REQUESTS", new Date(Date.UTC(2026, 5, 1))))
        .csv,
    );
    const waiting = parsed.headers.indexOf("Days Waiting");
    const bucket = parsed.headers.indexOf("Days Waiting Bucket");

    expect(parsed.rows[0]?.[waiting]).toBe("6");
    expect(parsed.rows[0]?.[bucket]).toBe("4-7");
  });

  it("includes client health and the completion figures", async () => {
    const parsed = parseCsv((await exportSheet(ctx, "CLIENTS")).csv);
    const health = parsed.headers.indexOf("Client Health");
    expect(parsed.rows[0]?.[health]).toBeTruthy();
  });
});

suite("cross-tenant isolation", () => {
  it("exports only the caller's organization", async () => {
    for (const sheet of IMPORT_ORDER) {
      const theirs = await exportSheet(rivalCtx, sheet);
      const parsed = parseCsv(theirs.csv);

      // An export is the widest possible leak — one CSV of a whole book of
      // business — so every sheet is checked, not a sample.
      const body = parsed.rows.flat().join(" ");
      expect(body, sheet).not.toContain("Brightline");
      expect(body, sheet).not.toContain("Morgan Reyes");
      expect(body, sheet).not.toContain("CL-0007");
    }
  });

  it("counts only the caller's organization", async () => {
    const mine = await getExportCounts(ctx);
    const theirs = await getExportCounts(rivalCtx);

    expect(mine.CLIENTS).toBe(1);
    expect(mine.TASKS).toBe(1);
    expect(theirs.CLIENTS).toBe(0);
    expect(theirs.TASKS).toBe(0);
    // The rival still has its own seeded settings and its owner.
    expect(theirs.EMPLOYEES).toBe(1);
  });

  it("counts every sheet the contract declares", async () => {
    const counts = await getExportCounts(ctx);
    for (const sheet of IMPORT_ORDER) {
      expect(counts[sheet], sheet).toBeGreaterThanOrEqual(0);
    }
  });
});

suite("round trip — the rollback path (§5)", () => {
  /**
   * Export from one organization, import into another, export again, and
   * compare. §5 names this as the post-cutover rollback path, so a column
   * that exports in a form the importer cannot read back is a broken rollback.
   */
  const IMPORTABLE_COLUMNS: Partial<Record<LegacySheet, string[]>> = {
    EMPLOYEES: [
      "Employee ID",
      "Employee Name",
      "Role",
      "Department",
      "Email",
      "Active?",
      "Capacity",
      "Notes",
    ],
    SERVICES: [
      "Service ID",
      "Service Name",
      "Category",
      "Description",
      "Active?",
    ],
    SERVICE_PACKAGES: [
      "Package ID",
      "Package Name",
      "Description",
      "Included Service Areas",
      "Active?",
    ],
    TASK_TEMPLATES: [
      "Template ID",
      "Service Package",
      "Service Area",
      "Task Name",
      "Description",
      "Frequency",
      "Priority",
      "Default Assignee",
      "Typical Duration (Days)",
      "Required Client Input?",
      "Active?",
    ],
    CLIENTS: [
      "Client ID",
      "Client Name",
      "Company Name",
      "Industry",
      "Business Type",
      "Start Date",
      "Service Package",
      "Account Manager",
      "Backup Team Member",
      "Client Contact",
      "Email",
      "Phone",
      "Accounting System",
      "Reporting Frequency",
      "Month-End Closing Date",
      "Contract Status",
      "Priority",
      "Notes",
    ],
    TASKS: [
      "Task ID",
      "Client ID",
      "Client Name",
      "Service Area",
      "Task Category",
      "Task Name",
      "Description",
      "Period",
      "Frequency",
      "Assigned To",
      "Priority",
      "Status",
      "Start Date",
      "Due Date",
      "Completion Date",
      "Waiting For",
      "Client Dependency",
      "Completion %",
      "Reviewer",
      "Review Status",
      "Notes",
    ],
    CLIENT_REQUESTS: [
      "Request ID",
      "Client ID",
      "Client",
      "Request",
      "Requested Date",
      "Required By",
      "Status",
      "Priority",
      "Assigned To",
      "Received Date",
      "Notes",
    ],
    ISSUES: [
      "Issue ID",
      "Client ID",
      "Client",
      "Issue",
      "Category",
      "Date Raised",
      "Severity",
      "Assigned To",
      "Status",
      "Impact",
      "Required Action",
      "Deadline",
      "Resolution Date",
      "Notes",
    ],
    MONTHLY_CLOSE: ["Client", "Month", ...MONTHLY_CLOSE_STAGES],
  };

  it("survives export → import → export unchanged, on every entity", async () => {
    // The rival is empty; load it entirely from the primary's exports.
    for (const sheet of IMPORT_ORDER) {
      if (sheet === "SETTINGS" || sheet === "ACTIVITY_LOG") continue;

      const exported = await exportSheet(ctx, sheet);
      const report = await commitImport(rivalCtx, sheet, exported.csv);

      expect(report.fatal, sheet).toBeNull();
      expect(report.failed, `${sheet}: ${report.rows[0]?.reason ?? ""}`).toBe(0);
    }

    // Now compare the two organizations' exports, column by column.
    for (const sheet of IMPORT_ORDER) {
      if (sheet === "SETTINGS" || sheet === "ACTIVITY_LOG") continue;

      const mine = parseCsv((await exportSheet(ctx, sheet)).csv);
      const theirsRaw = parseCsv((await exportSheet(rivalCtx, sheet)).csv);

      // The rollback target has its own admin account, which was never part of
      // the exported data. Excluded so the comparison is of the round trip and
      // not of the target's pre-existing setup.
      const ownerColumn = theirsRaw.headers.indexOf("Employee ID");
      const theirs =
        sheet === "EMPLOYEES"
          ? {
              ...theirsRaw,
              rows: theirsRaw.rows.filter(
                (row) => row[ownerColumn] !== "EMP-900",
              ),
            }
          : theirsRaw;

      const columns = IMPORTABLE_COLUMNS[sheet] ?? [];
      expect(theirs.rows.length, sheet).toBe(mine.rows.length);

      for (const column of columns) {
        const at = mine.headers.indexOf(column);
        // EMPLOYEES email differs by design — the round trip uses distinct
        // addresses per organization so both users can exist.
        if (sheet === "EMPLOYEES" && column === "Email") continue;

        const before = mine.rows.map((row) => row[at]).sort();
        const after = theirs.rows.map((row) => row[at]).sort();
        expect(after, `${sheet}.${column}`).toEqual(before);
      }
    }
  });

  it("REPORTS a display-ID collision rather than renumbering", async () => {
    // Importing into an organization that already uses an id is genuinely
    // ambiguous: EMP-001 there is a different person from EMP-001 here.
    // Silently renumbering would break the one thing display IDs are for —
    // staff citing them in email (audit §4) — so the row is reported instead.
    const collider = await buildOrg(
      `${SLUG}-collide`,
      "Collide Org",
      "collide",
      1,
    );

    const exported = await exportSheet(ctx, "EMPLOYEES");
    const report = await commitImport(collider, "EMPLOYEES", exported.csv);

    expect(report.failed).toBeGreaterThan(0);
    expect(
      report.rows.find((row) => row.outcome === "failed")?.reason,
    ).toBe("A record with these values already exists.");
    // And the rows that did NOT collide still imported — the savepoint rule.
    expect(report.imported).toBeGreaterThan(0);

    await prisma.organization.deleteMany({
      where: { slug: `${SLUG}-collide` },
    });
  });

  it("re-importing an export into the SAME organization changes nothing", async () => {
    // The idempotency rule, exercised through the rollback path rather than a
    // hand-built file.
    for (const sheet of IMPORT_ORDER) {
      if (sheet === "SETTINGS") continue;

      const exported = await exportSheet(ctx, sheet);
      const report = await commitImport(ctx, sheet, exported.csv);

      expect(report.imported, `${sheet} imported nothing new`).toBe(0);
      expect(report.skipped + report.failed, sheet).toBe(report.total);
    }
  });
});
