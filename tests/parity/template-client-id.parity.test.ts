import { describe, expect, it } from "vitest";

import {
  isDuplicateClient,
  resolveDefaultAssignee,
  validateClientFields,
} from "@/lib/domain/client";
import { Frequency, Priority, TaskCategory } from "@/lib/domain/enums";
import { formatDisplayId, parseDisplayId } from "@/lib/domain/ids";
import { buildTaskTemplateCatalog } from "@/lib/domain/task-template-catalog";
import { expandTemplateToTask, taskDedupeKey } from "@/lib/domain/template";
import type { DomainTaskTemplate } from "@/lib/domain/types";

import { d, makeMember } from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

// ---------------------------------------------------------------------------
// Template expansion — audit §6.11
// ---------------------------------------------------------------------------

const templateCtx = loadLegacyContext([...LEGACY_MODULES.templateLogic]);

const legacyExpand = legacyFn<
  (
    template: Record<string, unknown>,
    client: Record<string, unknown>,
    period: string,
    dueDate: Date,
    assignee: string,
    category: string,
  ) => Record<string, unknown>
>(templateCtx, "expandTemplateToTask");

const legacyDedupeKey = legacyFn<
  (clientId: string, area: string, name: string, period: string) => string
>(templateCtx, "taskDedupeKey");

const template: DomainTaskTemplate = {
  id: "tpl-1",
  servicePackageName: "Full Finance",
  serviceArea: "Bank Reconciliation",
  taskName: "Bank Reconciliation",
  description: "Reconcile bank statements.",
  frequency: Frequency.MONTHLY,
  priority: Priority.HIGH,
  defaultAssigneeRole: "Bookkeeper",
  typicalDurationDays: 2,
  requiresClientInput: true,
  isActive: true,
};

function toLegacyTemplate(t: DomainTaskTemplate): Record<string, unknown> {
  return {
    "Template ID": t.id,
    "Service Package": t.servicePackageName,
    "Service Area": t.serviceArea,
    "Task Name": t.taskName,
    Description: t.description ?? "",
    Frequency: "Monthly",
    Priority: "High",
    "Default Assignee": t.defaultAssigneeRole ?? "",
    "Typical Duration (Days)": t.typicalDurationDays,
    "Required Client Input?": t.requiresClientInput ? "Yes" : "No",
    "Active?": t.isActive ? "Yes" : "No",
  };
}

describe("parity: expandTemplateToTask", () => {
  const dueDate = d("2026-08-31");

  it("produces the same task fields as legacy", () => {
    const mine = expandTemplateToTask(
      template,
      "client-1",
      "2026-08",
      dueDate,
      "Bob Book",
      TaskCategory.RECURRING,
    );

    const theirs = legacyExpand(
      toLegacyTemplate(template),
      { "Client ID": "client-1", "Client Name": "Acme Co" },
      "2026-08",
      dueDate,
      "Bob Book",
      "Recurring",
    );

    expect(mine.serviceArea).toBe(theirs["Service Area"]);
    expect(mine.taskName).toBe(theirs["Task Name"]);
    expect(mine.description).toBe(theirs["Description"]);
    expect(mine.period).toBe(theirs["Period"]);
    expect(mine.assignedToName).toBe(theirs["Assigned To"]);
    expect(mine.dueDate.getTime()).toBe((theirs["Due Date"] as Date).getTime());
    expect(mine.completionPct).toBe(theirs["Completion %"]);

    // Legacy encoded these as display strings; the port uses enums.
    expect(mine.status).toBe("NOT_STARTED");
    expect(theirs["Status"]).toBe("Not Started");
    expect(mine.reviewStatus).toBe("NOT_REVIEWED");
    expect(theirs["Review Status"]).toBe("Not Reviewed");
    expect(mine.clientDependency).toBe(true);
    expect(theirs["Client Dependency"]).toBe("Yes");
  });

  it("maps a template not requiring client input to false / 'No'", () => {
    const noInput = { ...template, requiresClientInput: false };
    const mine = expandTemplateToTask(
      noInput,
      "client-1",
      "2026-08",
      dueDate,
      null,
      TaskCategory.ONBOARDING,
    );
    const theirs = legacyExpand(
      toLegacyTemplate(noInput),
      { "Client ID": "client-1", "Client Name": "Acme Co" },
      "2026-08",
      dueDate,
      "",
      "Onboarding",
    );

    expect(mine.clientDependency).toBe(false);
    expect(theirs["Client Dependency"]).toBe("No");
  });
});

describe("parity: taskDedupeKey", () => {
  const cases: [string, string, string, string][] = [
    ["c1", "Bookkeeping", "Daily Bookkeeping", "2026-08"],
    ["c2", "P&L", "Monthly P&L", "2026-12"],
    ["c1", "", "", ""],
  ];

  it.each(cases)("(%s, %s, %s, %s)", (clientId, area, name, period) => {
    expect(taskDedupeKey(clientId, area, name, period)).toBe(
      legacyDedupeKey(clientId, area, name, period),
    );
  });

  it("treats a null period the same as an empty one", () => {
    expect(taskDedupeKey("c1", "A", "B", null)).toBe(
      legacyDedupeKey("c1", "A", "B", ""),
    );
  });
});

// ---------------------------------------------------------------------------
// Client rules — audit §6.9, §6.10
// ---------------------------------------------------------------------------

const clientCtx = loadLegacyContext([...LEGACY_MODULES.clientLogic]);

const legacyValidate = legacyFn<
  (client: Record<string, unknown>) => { valid: boolean; errors: string[] }
>(clientCtx, "validateClientFields");

const legacyIsDuplicate = legacyFn<
  (
    candidate: Record<string, unknown>,
    existing: Record<string, unknown>[],
  ) => boolean
>(clientCtx, "isDuplicateClient");

const legacyResolveAssignee = legacyFn<
  (
    role: string,
    client: Record<string, unknown>,
    employees: Record<string, unknown>[],
  ) => string
>(clientCtx, "resolveDefaultAssignee");

describe("parity: validateClientFields", () => {
  const cases = [
    { name: "Acme", servicePackageName: "Basic Accounting", accountManagerName: "Jane", startDate: d("2026-01-01") },
    { name: "", servicePackageName: "Basic Accounting", accountManagerName: "Jane", startDate: d("2026-01-01") },
    { name: "Acme", servicePackageName: "", accountManagerName: "Jane", startDate: d("2026-01-01") },
    { name: "Acme", servicePackageName: "Basic Accounting", accountManagerName: "", startDate: d("2026-01-01") },
    { name: "Acme", servicePackageName: "Basic Accounting", accountManagerName: "Jane", startDate: null },
    { name: "", servicePackageName: "", accountManagerName: "", startDate: null },
  ];

  it.each(cases)("%o", (input) => {
    const mine = validateClientFields(input);
    const theirs = legacyValidate({
      "Client Name": input.name,
      "Service Package": input.servicePackageName,
      "Account Manager": input.accountManagerName,
      "Start Date": input.startDate ?? "",
    });

    expect(mine.valid).toBe(theirs.valid);
    expect(mine.errors).toEqual(theirs.errors);
  });

  it("requires Start Date, which the CoreWorks brief omitted (conflict C2)", () => {
    const result = validateClientFields({
      name: "Acme",
      servicePackageName: "Basic Accounting",
      accountManagerName: "Jane",
      startDate: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Start Date is required.");
  });
});

describe("parity: isDuplicateClient", () => {
  const existing = [
    { name: "Acme", companyName: "Acme Ltd" },
    { name: "Beta", companyName: null },
  ];

  const candidates = [
    { name: "Acme", companyName: "Acme Ltd" }, // exact duplicate
    { name: "Acme", companyName: "Acme GmbH" }, // same name, different company
    { name: "Gamma", companyName: "Acme Ltd" }, // same company, different name
    { name: "Beta", companyName: null }, // both null company
    { name: "Delta", companyName: "Delta Ltd" }, // brand new
  ];

  it.each(candidates)("%o", (candidate) => {
    const mine = isDuplicateClient(candidate, existing);
    const theirs = legacyIsDuplicate(
      {
        "Client Name": candidate.name,
        "Company Name": candidate.companyName ?? "",
      },
      existing.map((c) => ({
        "Client Name": c.name,
        "Company Name": c.companyName ?? "",
      })),
    );
    expect(mine).toBe(theirs);
  });
});

describe("parity: resolveDefaultAssignee", () => {
  const members = [
    makeMember({ name: "Jane AM", jobTitle: "Account Manager", isActive: true }),
    makeMember({ name: "Bob Book", jobTitle: "Bookkeeper", isActive: true }),
    makeMember({ name: "Old Bob", jobTitle: "Bookkeeper", isActive: false }),
    makeMember({ name: "Sam Senior", jobTitle: "Senior Accountant", isActive: true }),
  ];

  const legacyEmployees = members.map((m) => ({
    "Employee Name": m.name,
    Role: m.jobTitle ?? "",
    "Active?": m.isActive ? "Yes" : "No",
  }));

  const roles = [
    "Account Manager",
    "Bookkeeper",
    "Senior Accountant",
    "FP&A Analyst", // nobody holds this
    "",
  ];

  it.each(roles)("role=%s with a matching account manager", (role) => {
    const mine = resolveDefaultAssignee(role, "Jane AM", members);
    const theirs = legacyResolveAssignee(
      role,
      { "Account Manager": "Jane AM" },
      legacyEmployees,
    );
    expect(mine ?? "").toBe(theirs);
  });

  it.each(roles)("role=%s with a non-matching account manager", (role) => {
    const mine = resolveDefaultAssignee(role, "Sam Senior", members);
    const theirs = legacyResolveAssignee(
      role,
      { "Account Manager": "Sam Senior" },
      legacyEmployees,
    );
    expect(mine ?? "").toBe(theirs);
  });

  it("never leaves a task unassigned when an account manager exists", () => {
    expect(resolveDefaultAssignee("Nonexistent Role", "Jane AM", members)).toBe(
      "Jane AM",
    );
  });

  it("skips inactive members when matching by role", () => {
    // "Old Bob" is an inactive Bookkeeper listed before nobody else; the
    // active "Bob Book" must win.
    expect(resolveDefaultAssignee("Bookkeeper", "Jane AM", members)).toBe(
      "Bob Book",
    );
  });
});

// ---------------------------------------------------------------------------
// ID formats — audit §4
// ---------------------------------------------------------------------------

const idCtx = loadLegacyContext([...LEGACY_MODULES.idLogic]);

const legacyNextSequentialId = legacyFn<
  (existing: string[], prefix: string, pad: number) => string
>(idCtx, "nextSequentialId");

describe("parity: display id FORMAT matches legacy generation", () => {
  // The mechanism deliberately differs (audit D3: scan-max races under
  // concurrency). The FORMAT must not.
  const cases: [string, string, number, number][] = [
    ["CLIENT", "CL-", 4, 7],
    ["MEMBER", "EMP-", 3, 12],
    ["TASK", "TSK-", 6, 4321],
    ["TASK_TEMPLATE", "TPL-", 3, 14],
    ["CLIENT_REQUEST", "REQ-", 4, 88],
    ["ISSUE", "ISS-", 4, 21],
    ["ACTIVITY", "ACT-", 7, 1234],
    ["SERVICE", "SVC-", 3, 14],
    ["SERVICE_PACKAGE", "PKG-", 3, 3],
  ];

  it.each(cases)("%s", (entity, prefix, pad, value) => {
    // Legacy derives the next id from the highest existing one.
    const existing = [`${prefix}${String(value - 1).padStart(pad, "0")}`];
    const theirs = legacyNextSequentialId(existing, prefix, pad);
    const mine = formatDisplayId(
      entity as Parameters<typeof formatDisplayId>[0],
      value,
    );
    expect(mine).toBe(theirs);
  });

  it("starts at 1 on an empty set, like legacy", () => {
    expect(formatDisplayId("CLIENT", 1)).toBe(
      legacyNextSequentialId([], "CL-", 4),
    );
  });

  it("ignores malformed ids when parsing, like legacy", () => {
    // Legacy skipped non-matching ids so a stray row could not corrupt
    // numbering; the port's parse is the equivalent guard when seeding a
    // sequence from imported data.
    expect(parseDisplayId("CLIENT", "CL-00A7")).toBeNull();
    expect(legacyNextSequentialId(["CL-00A7"], "CL-", 4)).toBe("CL-0001");
  });
});

// ---------------------------------------------------------------------------
// Catalog — audit §6.12 / defect D6
// ---------------------------------------------------------------------------

const catalogCtx = loadLegacyContext([...LEGACY_MODULES.taskTemplateCatalog]);
const legacyBuildSeed = legacyFn<() => { servicePackage: string }[]>(
  catalogCtx,
  "buildTaskTemplateSeed",
);

describe("parity: task template catalog", () => {
  it("matches legacy tier composition exactly", () => {
    const mine = buildTaskTemplateCatalog();
    const theirs = legacyBuildSeed();

    const count = (rows: { servicePackage: string }[], pkg: string) =>
      rows.filter((r) => r.servicePackage === pkg).length;

    expect(mine).toHaveLength(theirs.length);
    expect(mine).toHaveLength(47);

    for (const pkg of ["Basic Accounting", "Full Finance", "CFO / FP&A"]) {
      expect(count(mine, pkg), pkg).toBe(count(theirs, pkg));
    }

    expect(count(mine, "CFO / FP&A")).toBe(22);
  });

  it("matches legacy task names per tier, in order", () => {
    const mine = buildTaskTemplateCatalog();
    const theirs = legacyBuildSeed() as { servicePackage: string; taskName: string }[];

    expect(mine.map((r) => `${r.servicePackage}|${r.taskName}`)).toEqual(
      theirs.map((r) => `${r.servicePackage}|${r.taskName}`),
    );
  });
});
