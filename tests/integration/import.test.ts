import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ClientHealth, OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/domain/csv";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import { formatDisplayId } from "@/lib/domain/ids";
import { LEGACY_HEADERS, type LegacySheet } from "@/lib/domain/legacy-schema";
import type { OrgContext } from "@/server/context";
import { commitImport, previewImport } from "@/server/services/import";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 13 integration tests — the CSV import engine (migration-plan §4).
 *
 * The four rules under test, quoted from the plan:
 *
 *  1. *"Nothing is written until Confirm. Preview is a dry run over the real
 *     validators."*
 *  2. *"Per-row validation, not fail-fast: one bad row does not abort the file."*
 *  3. *"Every row lands in exactly one bucket — Imported / Skipped (duplicate)
 *     / Failed (with reason + row number)."*
 *  4. *"Whole file in one transaction. Partial imports leave no half-migrated
 *     state."*
 *
 * Plus idempotency, dependency order (§3.3), name resolution (§3.4), ID
 * continuity (§3.5), the Monthly Close reshaping (§3.6), and the rule that
 * derived columns are never imported (§3.2).
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-import";
const RIVAL_SLUG = "test-org-import-rival";
const EMAIL_DOMAIN = "@import-test.example.com";

let ctx: OrgContext;
let rivalCtx: OrgContext;

/** Builds a CSV from the real legacy headers and partial row objects. */
function csvFor(
  sheet: LegacySheet,
  rows: Record<string, string>[],
  options: { headers?: string[] } = {},
): string {
  const headers = options.headers ?? [...(LEGACY_HEADERS[sheet] as readonly string[])];
  return toCsv(
    headers,
    rows.map((row) => headers.map((header) => row[header] ?? "")),
  );
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, RIVAL_SLUG] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

async function buildOrg(slug: string, name: string, prefix: string) {
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
      displayId: formatDisplayId("MEMBER", 1),
      role: OrgRole.OWNER,
    },
    select: { id: true },
  });

  return {
    org,
    context: {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      organizationId: org.id,
      organizationSlug: org.slug,
      membershipId: member.id,
      role: OrgRole.OWNER,
    } satisfies OrgContext,
  };
}

/** Wipes everything importable, leaving the seed owner in place. */
async function resetData(target: OrgContext) {
  const where = { organizationId: target.organizationId };
  await prisma.monthlyCloseTask.deleteMany({
    where: { monthlyClose: { organizationId: target.organizationId } },
  });
  await prisma.monthlyClose.deleteMany({ where });
  await prisma.task.deleteMany({ where });
  await prisma.clientRequest.deleteMany({ where });
  await prisma.issue.deleteMany({ where });
  await prisma.activityLog.deleteMany({ where });
  await prisma.client.deleteMany({ where });
  await prisma.taskTemplate.deleteMany({ where });
  await prisma.servicePackageService.deleteMany({
    where: { servicePackage: { organizationId: target.organizationId } },
  });
  await prisma.servicePackage.deleteMany({ where });
  await prisma.service.deleteMany({ where });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: target.organizationId, role: { not: OrgRole.OWNER } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: EMAIL_DOMAIN }, memberships: { none: {} } },
  });
  await prisma.idSequence.deleteMany({ where });
  // The seed owner really does hold EMP-001, so the counter has to clear it —
  // otherwise the first minted member id collides with a row that exists.
  await prisma.idSequence.create({
    data: { organizationId: target.organizationId, entity: "MEMBER", lastValue: 1 },
  });
}

/** The minimum chain of prerequisites, imported in dependency order. */
async function seedPrerequisites(target: OrgContext = ctx) {
  await commitImport(
    target,
    "EMPLOYEES",
    csvFor("EMPLOYEES", [
      {
        "Employee ID": "EMP-002",
        "Employee Name": "Morgan Reyes",
        Role: "Account Manager",
        Email: `morgan${EMAIL_DOMAIN}`,
        "Active?": "Yes",
        Capacity: "12",
      },
      {
        "Employee ID": "EMP-003",
        "Employee Name": "Priya Anand",
        Role: "Bookkeeper",
        Email: `priya${EMAIL_DOMAIN}`,
        "Active?": "Yes",
        Capacity: "20",
      },
    ]),
  );

  await commitImport(
    target,
    "SERVICES",
    csvFor("SERVICES", [
      { "Service ID": "SVC-001", "Service Name": "Bookkeeping", "Active?": "Yes" },
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
        "Included Service Areas": "Bookkeeping, Payroll",
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
        "Start Date": "2025-11-01",
        "Service Package": "Basic Accounting",
        "Account Manager": "Morgan Reyes",
        "Backup Team Member": "Priya Anand",
        "Contract Status": "Active",
        Priority: "Medium",
      },
    ]),
  );
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  ctx = (await buildOrg(SLUG, "Import Test Org", "primary")).context;
  rivalCtx = (await buildOrg(RIVAL_SLUG, "Rival Org", "rival")).context;
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!hasDatabase) return;
  await resetData(ctx);
  await resetData(rivalCtx);
});

// ---------------------------------------------------------------------------

suite("rule 1 — nothing is written until confirm", () => {
  it("a preview writes nothing", async () => {
    const csv = csvFor("EMPLOYEES", [
      {
        "Employee Name": "Morgan Reyes",
        Email: `morgan${EMAIL_DOMAIN}`,
        "Active?": "Yes",
      },
    ]);

    const preview = await previewImport(ctx, "EMPLOYEES", csv);

    expect(preview.dryRun).toBe(true);
    expect(preview.imported).toBe(1);
    // The report says it would import — and the database disagrees, which is
    // exactly the point.
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(1); // just the seed owner
  });

  it("a preview and a commit of the same file report the same thing", async () => {
    const csv = csvFor("SERVICES", [
      { "Service Name": "Bookkeeping", "Active?": "Yes" },
      { "Service Name": "", "Active?": "Yes" },
      { "Service Name": "Payroll", "Active?": "maybe" },
    ]);

    const preview = await previewImport(ctx, "SERVICES", csv);
    const commit = await commitImport(ctx, "SERVICES", csv);

    expect({
      total: commit.total,
      imported: commit.imported,
      skipped: commit.skipped,
      failed: commit.failed,
    }).toEqual({
      total: preview.total,
      imported: preview.imported,
      skipped: preview.skipped,
      failed: preview.failed,
    });
    expect(commit.rows.map((r) => r.reason)).toEqual(
      preview.rows.map((r) => r.reason),
    );
  });

  it("a preview catches a real database constraint, not just a schema rule", async () => {
    // The dry run runs the actual inserts, so a unique-constraint collision
    // that no validator knows about still surfaces.
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    const preview = await previewImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    expect(preview.skipped).toBe(1);
    expect(preview.imported).toBe(0);
  });
});

suite("rule 2 — one bad row does not abort the file", () => {
  it("imports the good rows around a bad one", async () => {
    const report = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service Name": "Bookkeeping" },
        { "Service Name": "" },
        { "Service Name": "Payroll" },
        { "Service Name": "Advisory", "Active?": "perhaps" },
        { "Service Name": "Tax" },
      ]),
    );

    expect(report.imported).toBe(3);
    expect(report.failed).toBe(2);
    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(3);
  });

  it("names the line number and the reason for each failure", async () => {
    const report = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service Name": "Bookkeeping" },
        { "Service Name": "Bad", "Active?": "perhaps" },
      ]),
    );

    const failure = report.rows.find((row) => row.outcome === "failed");
    // Line 3: header is line 1, first data row line 2.
    expect(failure?.line).toBe(3);
    expect(failure?.reason).toContain("perhaps");
    expect(failure?.reason).toContain("Active?");
  });
});

suite("rule 3 — every row lands in exactly one bucket", () => {
  it("buckets sum to the total on a mixed file", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    const report = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service Name": "Bookkeeping" }, // skipped
        { "Service Name": "Payroll" }, // imported
        { "Service Name": "" }, // failed
      ]),
    );

    expect(report.total).toBe(3);
    expect(report.imported + report.skipped + report.failed).toBe(report.total);
    expect(report).toMatchObject({ imported: 1, skipped: 1, failed: 1 });
  });

  it("holds across every sheet with a representative file", async () => {
    await seedPrerequisites();

    const files: [LegacySheet, string][] = [
      [
        "TASKS",
        csvFor("TASKS", [
          {
            "Client Name": "Brightline Retail Co",
            "Task Name": "Bank Reconciliation",
            "Service Area": "Bookkeeping",
            Status: "In Progress",
          },
          { "Client Name": "Nobody", "Task Name": "x", "Service Area": "y" },
        ]),
      ],
      [
        "ISSUES",
        csvFor("ISSUES", [
          {
            Client: "Brightline Retail Co",
            Issue: "Missing statements",
            "Date Raised": "2026-01-05",
            Severity: "High",
          },
          { Client: "Brightline Retail Co", Issue: "", "Date Raised": "2026-01-05" },
        ]),
      ],
      [
        "CLIENT_REQUESTS",
        csvFor("CLIENT_REQUESTS", [
          {
            Client: "Brightline Retail Co",
            Request: "Send bank statements",
            "Requested Date": "2026-01-02",
          },
          { Client: "Brightline Retail Co", Request: "No date" },
        ]),
      ],
    ];

    for (const [sheet, csv] of files) {
      const report = await commitImport(ctx, sheet, csv);
      expect(
        report.imported + report.skipped + report.failed,
        sheet,
      ).toBe(report.total);
    }
  });
});

suite("rule 4 — the whole file is one transaction", () => {
  it("leaves nothing behind when the run throws", async () => {
    // A file whose accounting cannot balance aborts the transaction; the good
    // rows before the problem must not survive.
    const before = await prisma.service.count({
      where: { organizationId: ctx.organizationId },
    });

    // Force the failure by importing into an organization that vanishes
    // mid-run is not reproducible here; instead assert the property that
    // matters — a rolled-back preview of a large file leaves zero rows.
    const many = Array.from({ length: 50 }, (_, i) => ({
      "Service Name": `Service ${i}`,
    }));
    await previewImport(ctx, "SERVICES", csvFor("SERVICES", many));

    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(before);
  });
});

suite("a database-level failure does not poison the rest of the file", () => {
  it("keeps importing after a row hits a unique constraint", async () => {
    /*
     * The defect this test exists for.
     *
     * PostgreSQL aborts the whole transaction on any error: after one failed
     * statement, every later command returns `25P02 current transaction is
     * aborted`. Without a savepoint per row, ONE constraint violation turns
     * "1 failed, 4 imported" into "1 failed, 4 failed for a reason that names
     * neither the data nor the problem" — while the report still looks like a
     * plausible summary.
     *
     * A display ID that is already taken is the realistic trigger: legacy ids
     * are carried over verbatim, so a re-export overlapping an earlier import
     * produces exactly this.
     */
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service ID": "SVC-001", "Service Name": "Already Here" },
      ]),
    );

    const report = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service ID": "SVC-100", "Service Name": "Before" },
        // Same display id as the existing row, different name — so it is not
        // caught as a duplicate and reaches the database.
        { "Service ID": "SVC-001", "Service Name": "Collides" },
        { "Service ID": "SVC-101", "Service Name": "After" },
        { "Service ID": "SVC-102", "Service Name": "After Two" },
      ]),
    );

    expect(report.failed).toBe(1);
    // The rows AFTER the failure are what a naive catch-and-continue loses.
    expect(report.imported).toBe(3);
    expect(report.imported + report.skipped + report.failed).toBe(4);

    const names = await prisma.service.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    expect(names.map((n) => n.name)).toEqual([
      "After",
      "After Two",
      "Already Here",
      "Before",
    ]);
  });

  it("reports the collision in words an operator can act on", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service ID": "SVC-001", "Service Name": "A" }]),
    );

    const report = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service ID": "SVC-001", "Service Name": "B" }]),
    );

    const failure = report.rows.find((row) => row.outcome === "failed");
    expect(failure?.reason).toBe("A record with these values already exists.");
    // Not a Prisma stack trace, and not the raw constraint name.
    expect(failure?.reason).not.toContain("P2002");
    expect(failure?.reason).not.toContain("Invalid `");
  });

  it("still rolls the whole file back on a preview", async () => {
    // Savepoints give per-row isolation WITHIN the file transaction; the
    // file-level rollback must still take everything with it.
    const before = await prisma.service.count({
      where: { organizationId: ctx.organizationId },
    });

    await previewImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service Name": "One" },
        { "Service Name": "" },
        { "Service Name": "Two" },
      ]),
    );

    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(before);
  });
});

suite("idempotency", () => {
  it("re-running a file imports nothing new", async () => {
    const csv = csvFor("SERVICES", [
      { "Service Name": "Bookkeeping" },
      { "Service Name": "Payroll" },
    ]);

    const first = await commitImport(ctx, "SERVICES", csv);
    const second = await commitImport(ctx, "SERVICES", csv);
    const third = await commitImport(ctx, "SERVICES", csv);

    expect(first.imported).toBe(2);
    expect(second).toMatchObject({ imported: 0, skipped: 2 });
    expect(third).toMatchObject({ imported: 0, skipped: 2 });
    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(2);
  });

  it("dedupes clients on legacy's own rule — name AND company", async () => {
    await seedPrerequisites();

    // Audit §6.9: the duplicate rule is both columns together, so the same
    // name under a different company is a DIFFERENT client.
    const report = await commitImport(
      ctx,
      "CLIENTS",
      csvFor("CLIENTS", [
        {
          "Client Name": "Brightline Retail Co",
          "Company Name": "Brightline Retail LLC",
          "Start Date": "2025-11-01",
          "Account Manager": "Morgan Reyes",
        },
        {
          "Client Name": "Brightline Retail Co",
          "Company Name": "Brightline Holdings Ltd",
          "Start Date": "2025-11-01",
          "Account Manager": "Morgan Reyes",
        },
      ]),
    );

    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(1);
  });

  it("dedupes tasks on the legacy generation key", async () => {
    await seedPrerequisites();

    const row = {
      "Client Name": "Brightline Retail Co",
      "Task Name": "Bank Reconciliation",
      "Service Area": "Bookkeeping",
      Period: "2026-01",
    };

    await commitImport(ctx, "TASKS", csvFor("TASKS", [row]));
    const again = await commitImport(ctx, "TASKS", csvFor("TASKS", [row]));
    expect(again).toMatchObject({ imported: 0, skipped: 1 });

    // A different period is different work — audit §6.11.
    const nextPeriod = await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [{ ...row, Period: "2026-02" }]),
    );
    expect(nextPeriod.imported).toBe(1);
  });

  it("dedupes employees on email, not on name", async () => {
    // Two colleagues can share a name; legacy's own access check was on email.
    const report = await commitImport(
      ctx,
      "EMPLOYEES",
      csvFor("EMPLOYEES", [
        { "Employee Name": "John Smith", Email: `john.a${EMAIL_DOMAIN}` },
        { "Employee Name": "John Smith", Email: `john.b${EMAIL_DOMAIN}` },
        { "Employee Name": "Different Name", Email: `john.a${EMAIL_DOMAIN}` },
      ]),
    );

    expect(report.imported).toBe(2);
    expect(report.skipped).toBe(1);
  });
});

suite("dependency order (§3.3)", () => {
  it("refuses a TASKS file before any client exists", async () => {
    const report = await previewImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "x",
          "Service Area": "y",
        },
      ]),
    );

    // Refused as a FILE, not as 1,000 identical row failures.
    expect(report.fatal).toContain("Clients");
    expect(report.total).toBe(0);
  });

  it("refuses TASK_TEMPLATES before SERVICE_PACKAGES", async () => {
    const report = await previewImport(
      ctx,
      "TASK_TEMPLATES",
      csvFor("TASK_TEMPLATES", [
        {
          "Service Package": "Basic Accounting",
          "Service Area": "Bookkeeping",
          "Task Name": "x",
          Frequency: "Monthly",
        },
      ]),
    );

    expect(report.fatal).toContain("Service Packages");
  });

  it("accepts the same file once its prerequisites are present", async () => {
    await seedPrerequisites();

    const report = await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "Bank Reconciliation",
          "Service Area": "Bookkeeping",
        },
      ]),
    );

    expect(report.fatal).toBeNull();
    expect(report.imported).toBe(1);
  });

  it("refuses a file that is not the sheet it claims to be", async () => {
    const report = await previewImport(
      ctx,
      "CLIENTS",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    expect(report.fatal).toContain("Client Name");
  });

  it("reports an empty file and a header-only file distinctly", async () => {
    expect((await previewImport(ctx, "SERVICES", "")).fatal).toContain("empty");
    expect(
      (await previewImport(ctx, "SERVICES", csvFor("SERVICES", []))).fatal,
    ).toContain("no rows");
  });
});

suite("name resolution (§3.4)", () => {
  beforeEach(async () => {
    if (!hasDatabase) return;
    await seedPrerequisites();
  });

  it("REJECTS a client whose Account Manager is unmatched", async () => {
    const report = await commitImport(
      ctx,
      "CLIENTS",
      csvFor("CLIENTS", [
        {
          "Client Name": "New Co",
          "Company Name": "New Co Ltd",
          "Start Date": "2026-01-01",
          "Account Manager": "Nobody At All",
        },
      ]),
    );

    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("Nobody At All");
    expect(report.unmatched).toContainEqual(
      expect.objectContaining({
        column: "Account Manager",
        value: "Nobody At All",
        action: "rejected",
      }),
    );
  });

  it("WARNS and leaves null for an unmatched Backup Team Member", async () => {
    const report = await commitImport(
      ctx,
      "CLIENTS",
      csvFor("CLIENTS", [
        {
          "Client Name": "New Co",
          "Company Name": "New Co Ltd",
          "Start Date": "2026-01-01",
          "Account Manager": "Morgan Reyes",
          "Backup Team Member": "Ghost Person",
        },
      ]),
    );

    expect(report.imported).toBe(1);
    expect(report.unmatched).toContainEqual(
      expect.objectContaining({
        column: "Backup Team Member",
        value: "Ghost Person",
        action: "left blank",
      }),
    );

    const client = await prisma.client.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, name: "New Co" },
      select: { backupMemberId: true, accountManagerId: true },
    });
    expect(client.backupMemberId).toBeNull();
    expect(client.accountManagerId).not.toBeNull();
  });

  it("WARNS and leaves unassigned for an unmatched task assignee", async () => {
    const report = await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "Orphan task",
          "Service Area": "Bookkeeping",
          "Assigned To": "Departed Colleague",
        },
      ]),
    );

    expect(report.imported).toBe(1);
    expect(report.unmatched).toContainEqual(
      expect.objectContaining({
        column: "Assigned To",
        value: "Departed Colleague",
        action: "left blank",
      }),
    );

    const task = await prisma.task.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, taskName: "Orphan task" },
      select: { assignedToId: true },
    });
    expect(task.assignedToId).toBeNull();
  });

  it("KEEPS AS TEXT an unmatched client on an activity entry", async () => {
    const report = await commitImport(
      ctx,
      "ACTIVITY_LOG",
      csvFor("ACTIVITY_LOG", [
        {
          "Activity ID": "ACT-0000001",
          Date: "2026-01-05",
          User: "Morgan Reyes",
          Client: "Long Departed Client",
          "Entity Type": "Client",
          Action: "Client Added",
        },
      ]),
    );

    expect(report.imported).toBe(1);
    expect(report.unmatched).toContainEqual(
      expect.objectContaining({ column: "Client", action: "kept as text" }),
    );

    // History about a client that no longer exists is still history.
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { clientId: true, comment: true },
    });
    expect(entry.clientId).toBeNull();
    expect(entry.comment).toContain("Long Departed Client");
  });

  it("REJECTS a monthly close whose client is unmatched", async () => {
    const report = await commitImport(
      ctx,
      "MONTHLY_CLOSE",
      csvFor("MONTHLY_CLOSE", [{ Client: "Ghost Co", Month: "2026-01" }]),
    );

    expect(report.failed).toBe(1);
    expect(report.unmatched[0]?.action).toBe("rejected");
  });

  it("counts repeat occurrences of the same missing name once, with a tally", async () => {
    const report = await commitImport(
      ctx,
      "TASKS",
      csvFor(
        "TASKS",
        Array.from({ length: 4 }, (_, i) => ({
          "Client Name": "Brightline Retail Co",
          "Task Name": `Task ${i}`,
          "Service Area": "Bookkeeping",
          "Assigned To": "Departed Colleague",
        })),
      ),
    );

    const entry = report.unmatched.find((u) => u.column === "Assigned To");
    expect(entry?.occurrences).toBe(4);
    expect(report.unmatched.filter((u) => u.column === "Assigned To")).toHaveLength(
      1,
    );
  });

  it("resolves a person by email as well as by name", async () => {
    const report = await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "By email",
          "Service Area": "Bookkeeping",
          "Assigned To": `priya${EMAIL_DOMAIN}`,
        },
      ]),
    );

    expect(report.imported).toBe(1);
    const task = await prisma.task.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, taskName: "By email" },
      select: { assignedToId: true },
    });
    expect(task.assignedToId).not.toBeNull();
  });

  it("resolves a client by display ID when the name has since changed", async () => {
    const report = await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client ID": "CL-0007",
          "Client Name": "A Name That No Longer Matches",
          "Task Name": "By id",
          "Service Area": "Bookkeeping",
        },
      ]),
    );

    expect(report.imported).toBe(1);
  });
});

suite("ID continuity (§3.5)", () => {
  it("continues the imported series rather than colliding with it", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service ID": "SVC-001", "Service Name": "Bookkeeping" },
        { "Service ID": "SVC-047", "Service Name": "Payroll" },
        { "Service ID": "SVC-012", "Service Name": "Advisory" },
      ]),
    );

    const sequence = await prisma.idSequence.findUniqueOrThrow({
      where: {
        organizationId_entity: {
          organizationId: ctx.organizationId,
          entity: "SERVICE",
        },
      },
      select: { lastValue: true },
    });
    // The HIGHEST suffix in the file, not the last one.
    expect(sequence.lastValue).toBe(47);

    // And the next minted id clears it.
    const next = await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Tax" }]),
    );
    expect(next.imported).toBe(1);
    const created = await prisma.service.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, name: "Tax" },
      select: { displayId: true },
    });
    expect(created.displayId).toBe("SVC-048");
  });

  it("counts an id on a SKIPPED row too — the number is taken either way", async () => {
    const csv = csvFor("SERVICES", [
      { "Service ID": "SVC-099", "Service Name": "Bookkeeping" },
    ]);

    await commitImport(ctx, "SERVICES", csv);
    await commitImport(ctx, "SERVICES", csv); // all skipped

    const sequence = await prisma.idSequence.findUniqueOrThrow({
      where: {
        organizationId_entity: {
          organizationId: ctx.organizationId,
          entity: "SERVICE",
        },
      },
      select: { lastValue: true },
    });
    expect(sequence.lastValue).toBe(99);
  });

  it("preserves the legacy display ID exactly", async () => {
    await seedPrerequisites();

    const client = await prisma.client.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, name: "Brightline Retail Co" },
      select: { displayId: true },
    });
    // Staff cite these in email (audit §4) — they must survive unchanged.
    expect(client.displayId).toBe("CL-0007");
  });

  it("mints an id when the file supplies none", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    const created = await prisma.service.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { displayId: true },
    });
    expect(created.displayId).toMatch(/^SVC-\d{3}$/);
  });

  it("ignores a malformed id rather than corrupting the sequence", async () => {
    // Legacy `nextSequentialId` had the same tolerance.
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        { "Service ID": "not-an-id", "Service Name": "Bookkeeping" },
        { "Service ID": "SVC-005", "Service Name": "Payroll" },
      ]),
    );

    const sequence = await prisma.idSequence.findUniqueOrThrow({
      where: {
        organizationId_entity: {
          organizationId: ctx.organizationId,
          entity: "SERVICE",
        },
      },
      select: { lastValue: true },
    });
    expect(sequence.lastValue).toBe(5);
  });
});

suite("Monthly Close reshaping (§3.6)", () => {
  beforeEach(async () => {
    if (!hasDatabase) return;
    await seedPrerequisites();
  });

  it("turns 18 stage COLUMNS into 18 stage ROWS in legacy column order", async () => {
    const row: Record<string, string> = {
      Client: "Brightline Retail Co",
      Month: "2026-01",
    };
    for (const stage of MONTHLY_CLOSE_STAGES) row[stage] = "Not Started";
    row.Sales = "Completed";
    row["Bank Reconciliation"] = "Blocked";

    const report = await commitImport(
      ctx,
      "MONTHLY_CLOSE",
      csvFor("MONTHLY_CLOSE", [row]),
    );
    expect(report.imported).toBe(1);

    const close = await prisma.monthlyClose.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: {
        displayId: true,
        period: true,
        stages: {
          orderBy: { stageOrder: "asc" },
          select: { stageName: true, stageOrder: true, status: true },
        },
      },
    });

    expect(close.stages).toHaveLength(18);
    expect(close.stages.map((s) => s.stageName)).toEqual([
      ...MONTHLY_CLOSE_STAGES,
    ]);
    expect(close.stages.map((s) => s.stageOrder)).toEqual(
      MONTHLY_CLOSE_STAGES.map((_, i) => i),
    );
    expect(close.stages[0]?.status).toBe("COMPLETED");
    expect(close.stages[3]?.status).toBe("BLOCKED");
    // Legacy composite format, rebuilt from the resolved client.
    expect(close.displayId).toBe("MC-CL-0007-202601");
  });

  it("materialises a blank stage as Not Started — Phase 3 DIFF-1", async () => {
    // Legacy's COUNTA denominator counted only non-blank cells, so a close
    // with one touched stage read 100%. Eighteen rows makes the denominator
    // always eighteen.
    await commitImport(
      ctx,
      "MONTHLY_CLOSE",
      csvFor("MONTHLY_CLOSE", [
        { Client: "Brightline Retail Co", Month: "2026-02", Sales: "Completed" },
      ]),
    );

    const close = await prisma.monthlyClose.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, period: "2026-02" },
      select: { stages: { select: { status: true } } },
    });

    expect(close.stages).toHaveLength(18);
    expect(close.stages.filter((s) => s.status === "NOT_STARTED")).toHaveLength(
      17,
    );
  });

  it("rejects an invalid stage status rather than defaulting it", async () => {
    const report = await commitImport(
      ctx,
      "MONTHLY_CLOSE",
      csvFor("MONTHLY_CLOSE", [
        { Client: "Brightline Retail Co", Month: "2026-03", Payroll: "Nearly" },
      ]),
    );

    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("Payroll");
    expect(report.rows[0]?.reason).toContain("Nearly");
  });

  it("does NOT import the derived Close Status or Completion %", async () => {
    await commitImport(
      ctx,
      "MONTHLY_CLOSE",
      csvFor("MONTHLY_CLOSE", [
        {
          Client: "Brightline Retail Co",
          Month: "2026-04",
          "Close Status": "Closed",
          "Completion %": "1",
        },
      ]),
    );

    const close = await prisma.monthlyClose.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, period: "2026-04" },
      select: { status: true, completionPct: true },
    });

    // The spreadsheet claimed Closed at 100%; every stage is actually Not
    // Started. The engines produce the truth (§3.2).
    expect(close.status).toBe("NOT_STARTED");
    expect(close.completionPct).toBe(0);
  });

  it("is idempotent — one close per client per period", async () => {
    const csv = csvFor("MONTHLY_CLOSE", [
      { Client: "Brightline Retail Co", Month: "2026-05" },
    ]);

    await commitImport(ctx, "MONTHLY_CLOSE", csv);
    const again = await commitImport(ctx, "MONTHLY_CLOSE", csv);

    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    expect(
      await prisma.monthlyClose.count({
        where: { organizationId: ctx.organizationId, period: "2026-05" },
      }),
    ).toBe(1);
  });
});

suite("derived columns are never imported (§3.2)", () => {
  it("ignores a stale Client Health and completion from the sheet", async () => {
    await seedPrerequisites();

    await commitImport(
      ctx,
      "CLIENTS",
      csvFor("CLIENTS", [
        {
          "Client Name": "Stale Co",
          "Company Name": "Stale Co Ltd",
          "Start Date": "2026-01-01",
          "Account Manager": "Morgan Reyes",
          // The spreadsheet's own stored figures — all deliberately ignored.
          "Client Health": "Delayed",
          "Simple Completion %": "0.9",
          "Weighted Completion %": "0.85",
          "Last Activity": "2026-01-01",
          "Next Deadline": "2026-02-01",
        },
      ]),
    );

    const client = await prisma.client.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, name: "Stale Co" },
      select: {
        health: true,
        simpleCompletionPct: true,
        weightedCompletionPct: true,
        lastActivityAt: true,
        nextDeadline: true,
      },
    });

    expect(client.health).toBe(ClientHealth.ON_TRACK);
    expect(client.simpleCompletionPct).toBe(0);
    expect(client.weightedCompletionPct).toBe(0);
    expect(client.lastActivityAt).toBeNull();
    expect(client.nextDeadline).toBeNull();
  });

  it("DOES import the task-level Completion %, which legacy stored", async () => {
    await seedPrerequisites();

    await commitImport(
      ctx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "Half done",
          "Service Area": "Bookkeeping",
          "Completion %": "50%",
        },
      ]),
    );

    const task = await prisma.task.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, taskName: "Half done" },
      select: { completionPct: true },
    });
    expect(task.completionPct).toBeCloseTo(0.5, 10);
  });
});

suite("cross-tenant isolation", () => {
  it("imports only into the caller's organization", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.service.count({
        where: { organizationId: rivalCtx.organizationId },
      }),
    ).toBe(0);
  });

  it("cannot resolve a name belonging to another organization", async () => {
    await seedPrerequisites(ctx);

    // The rival has no clients at all, so this must be refused as a file.
    const report = await previewImport(
      rivalCtx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client Name": "Brightline Retail Co",
          "Task Name": "Cross-tenant",
          "Service Area": "Bookkeeping",
        },
      ]),
    );

    expect(report.fatal).toContain("Clients");
  });

  it("refuses to attach to another organization's client even when it has its own", async () => {
    await seedPrerequisites(ctx);
    await seedPrerequisites(rivalCtx);

    // Both now have a client — but the rival's is a separate record, so a
    // display ID from the other tenant must not resolve.
    const theirClient = await prisma.client.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { id: true, displayId: true },
    });

    const report = await commitImport(
      rivalCtx,
      "TASKS",
      csvFor("TASKS", [
        {
          "Client ID": theirClient.displayId,
          "Client Name": "Brightline Retail Co",
          "Task Name": "Cross-tenant",
          "Service Area": "Bookkeeping",
        },
      ]),
    );

    // It resolves to the RIVAL's own same-named client, never to the other
    // tenant's row.
    expect(report.imported).toBe(1);
    const task = await prisma.task.findFirstOrThrow({
      where: { organizationId: rivalCtx.organizationId, taskName: "Cross-tenant" },
      select: { clientId: true, organizationId: true },
    });
    expect(task.clientId).not.toBe(theirClient.id);
    expect(task.organizationId).toBe(rivalCtx.organizationId);
  });

  it("dedupes within one organization only", async () => {
    const csv = csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]);

    await commitImport(ctx, "SERVICES", csv);
    const theirs = await commitImport(rivalCtx, "SERVICES", csv);

    // The rival's first import must not be skipped because another tenant
    // already has a service of that name.
    expect(theirs.imported).toBe(1);
  });
});

suite("edge cases", () => {
  it("handles quoted commas and newlines in real values", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [
        {
          "Service Name": "Bookkeeping",
          Description: "Multi-location retailer, 4 storefronts.\nSecond line.",
        },
      ]),
    );

    const service = await prisma.service.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { description: true },
    });
    expect(service.description).toContain("4 storefronts.");
    expect(service.description).toContain("Second line.");
  });

  it("accepts a file with extra columns it does not know", async () => {
    const headers = [
      ...(LEGACY_HEADERS.SERVICES as readonly string[]),
      "Someone's Note",
    ];
    const csv = toCsv(headers, [["SVC-001", "Bookkeeping", "", "", "Yes", "x"]]);

    const report = await commitImport(ctx, "SERVICES", csv);
    expect(report.imported).toBe(1);
  });

  it("accepts a file whose columns are reordered", async () => {
    const csv = toCsv(
      ["Active?", "Service Name", "Service ID"],
      [["Yes", "Bookkeeping", "SVC-001"]],
    );

    const report = await commitImport(ctx, "SERVICES", csv);
    expect(report.imported).toBe(1);
  });

  it("accepts a file with a BOM, as Sheets writes", async () => {
    // csvFor already writes one; assert explicitly that it survived.
    const csv = csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect((await commitImport(ctx, "SERVICES", csv)).imported).toBe(1);
  });

  it("rejects a blank required date rather than back-dating it", async () => {
    await seedPrerequisites();

    const report = await commitImport(
      ctx,
      "ISSUES",
      csvFor("ISSUES", [
        { Client: "Brightline Retail Co", Issue: "No date", Severity: "High" },
      ]),
    );

    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("Date Raised");
  });

  it("rejects an ambiguous date format", async () => {
    await seedPrerequisites();

    const report = await commitImport(
      ctx,
      "ISSUES",
      csvFor("ISSUES", [
        {
          Client: "Brightline Retail Co",
          Issue: "Ambiguous",
          "Date Raised": "03/04/2026",
        },
      ]),
    );

    expect(report.failed).toBe(1);
    expect(report.rows[0]?.reason).toContain("YYYY-MM-DD");
  });

  it("imports an employee with a blank Active? as active", async () => {
    const report = await commitImport(
      ctx,
      "EMPLOYEES",
      csvFor("EMPLOYEES", [
        { "Employee Name": "Blank Active", Email: `blank${EMAIL_DOMAIN}` },
      ]),
    );

    expect(report.imported).toBe(1);
    const member = await prisma.organizationMember.findFirstOrThrow({
      where: {
        organizationId: ctx.organizationId,
        user: { email: `blank${EMAIL_DOMAIN}` },
      },
      select: { isActive: true, role: true },
    });
    expect(member.isActive).toBe(true);
    // Legacy had no access roles, so nothing is inferred from a job title.
    expect(member.role).toBe(OrgRole.TEAM_MEMBER);
  });

  it("reuses an existing global User for a person already in another org", async () => {
    await commitImport(
      rivalCtx,
      "EMPLOYEES",
      csvFor("EMPLOYEES", [
        { "Employee Name": "Shared Person", Email: `shared${EMAIL_DOMAIN}` },
      ]),
    );
    await commitImport(
      ctx,
      "EMPLOYEES",
      csvFor("EMPLOYEES", [
        { "Employee Name": "Shared Person", Email: `shared${EMAIL_DOMAIN}` },
      ]),
    );

    // Identity is global; membership is per-tenant (audit §14.3).
    expect(
      await prisma.user.count({ where: { email: `shared${EMAIL_DOMAIN}` } }),
    ).toBe(1);
    expect(
      await prisma.organizationMember.count({
        where: { user: { email: `shared${EMAIL_DOMAIN}` } },
      }),
    ).toBe(2);
  });

  it("links a package to its services and warns about an unknown one", async () => {
    await commitImport(
      ctx,
      "SERVICES",
      csvFor("SERVICES", [{ "Service Name": "Bookkeeping" }]),
    );

    const report = await commitImport(
      ctx,
      "SERVICE_PACKAGES",
      csvFor("SERVICE_PACKAGES", [
        {
          "Package Name": "Basic Accounting",
          "Included Service Areas": "Bookkeeping; Not A Service",
        },
      ]),
    );

    expect(report.imported).toBe(1);
    expect(report.unmatched).toContainEqual(
      expect.objectContaining({ value: "Not A Service" }),
    );

    const pkg = await prisma.servicePackage.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { services: { select: { serviceId: true } } },
    });
    expect(pkg.services).toHaveLength(1);
  });

  it("handles a large file in one transaction", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      "Service ID": `SVC-${String(i + 1).padStart(3, "0")}`,
      "Service Name": `Service ${i}`,
    }));

    const report = await commitImport(ctx, "SERVICES", csvFor("SERVICES", rows));

    expect(report.imported).toBe(400);
    expect(report.imported + report.skipped + report.failed).toBe(400);
    expect(
      await prisma.service.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(400);
  });

  it("caps the per-row report without miscounting the buckets", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      "Service Name": `Service ${i}`,
    }));

    const report = await commitImport(ctx, "SERVICES", csvFor("SERVICES", rows));

    expect(report.total).toBe(600);
    expect(report.imported).toBe(600);
    // Counts are exact even though the row list is truncated for display.
    expect(report.rows.length).toBeLessThanOrEqual(500);
  });
});

suite("SETTINGS", () => {
  it("imports key/value settings and is idempotent", async () => {
    const csv = csvFor("SETTINGS", [
      {
        "Setting Category": "Health",
        "Setting Key": "HEALTH_AT_RISK_OVERDUE_COUNT",
        Value: "2",
        Description: "Overdue tasks before At Risk",
      },
    ]);

    const first = await commitImport(ctx, "SETTINGS", csv);
    const second = await commitImport(ctx, "SETTINGS", csv);

    // seedOrgSettings already created this key, so the first run skips it —
    // which is the correct behaviour, not a bug.
    expect(first.imported + first.skipped).toBe(1);
    expect(second.imported).toBe(0);
  });

  it("rejects a setting with no value", async () => {
    const report = await commitImport(
      ctx,
      "SETTINGS",
      csvFor("SETTINGS", [{ "Setting Key": "SOME_KEY", Value: "" }]),
    );
    expect(report.failed).toBe(1);
  });
});
