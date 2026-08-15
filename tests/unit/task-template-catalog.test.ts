import { describe, expect, it } from "vitest";

import { Frequency, Priority } from "@/generated/prisma/enums";
import {
  BASIC_ACCOUNTING_TASKS,
  buildTaskTemplateCatalog,
  CFO_FPA_ADDITIONAL_TASKS,
  dedupeByTaskName,
  FULL_FINANCE_ADDITIONAL_TASKS,
  SERVICE_PACKAGE_NAMES,
} from "@/lib/domain/task-template-catalog";

/**
 * The catalog is legacy business content, not sample data. These counts were
 * verified by executing the legacy `buildTaskTemplateSeed()` directly against
 * the preserved source in /legacy (audit §6.12, defect D6) — they are the
 * observed output, not a reading of the documentation, which was wrong.
 */
describe("task template catalog", () => {
  const catalog = buildTaskTemplateCatalog();

  const forPackage = (name: string) =>
    catalog.filter((entry) => entry.servicePackage === name);

  it("matches the legacy tier composition", () => {
    expect(forPackage(SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING)).toHaveLength(9);
    expect(forPackage(SERVICE_PACKAGE_NAMES.FULL_FINANCE)).toHaveLength(16);
    expect(forPackage(SERVICE_PACKAGE_NAMES.CFO_FPA)).toHaveLength(22);
    expect(catalog).toHaveLength(47);
  });

  it("builds Full Finance as Basic plus its additional tasks", () => {
    expect(FULL_FINANCE_ADDITIONAL_TASKS).toHaveLength(7);
    expect(
      BASIC_ACCOUNTING_TASKS.length + FULL_FINANCE_ADDITIONAL_TASKS.length,
    ).toBe(16);

    const fullFinanceNames = forPackage(
      SERVICE_PACKAGE_NAMES.FULL_FINANCE,
    ).map((entry) => entry.taskName);

    for (const basic of BASIC_ACCOUNTING_TASKS) {
      expect(fullFinanceNames).toContain(basic.taskName);
    }
  });

  it("builds CFO / FP&A as Full Finance plus its additional tasks", () => {
    expect(CFO_FPA_ADDITIONAL_TASKS).toHaveLength(6);

    const cfoNames = forPackage(SERVICE_PACKAGE_NAMES.CFO_FPA).map(
      (entry) => entry.taskName,
    );

    for (const template of [
      ...BASIC_ACCOUNTING_TASKS,
      ...FULL_FINANCE_ADDITIONAL_TASKS,
      ...CFO_FPA_ADDITIONAL_TASKS,
    ]) {
      expect(cfoNames).toContain(template.taskName);
    }
  });

  it("has no duplicate task name within any tier", () => {
    for (const packageName of Object.values(SERVICE_PACKAGE_NAMES)) {
      const names = forPackage(packageName).map((entry) => entry.taskName);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("gives every tier its own rows rather than sharing them", () => {
    // Legacy queries TASK_TEMPLATES by exact Service Package match, so a
    // shared row would simply never be found for the other tiers.
    const bankRec = catalog.filter(
      (entry) => entry.taskName === "Bank Reconciliation",
    );
    expect(bankRec).toHaveLength(3);
    expect(new Set(bankRec.map((e) => e.servicePackage)).size).toBe(3);
  });

  it("marks Month-End Close Critical — it drives the Delayed health rule", () => {
    const monthEnd = catalog.filter(
      (entry) => entry.taskName === "Month-End Close",
    );
    expect(monthEnd.length).toBeGreaterThan(0);
    for (const entry of monthEnd) {
      expect(entry.priority).toBe(Priority.CRITICAL);
      expect(entry.serviceArea).toBe("Month-End Closing");
    }
  });

  it("keeps the legacy frequency spread", () => {
    const frequencies = new Set(catalog.map((entry) => entry.frequency));
    expect(frequencies).toContain(Frequency.DAILY);
    expect(frequencies).toContain(Frequency.MONTHLY);
    expect(frequencies).toContain(Frequency.QUARTERLY);
    expect(frequencies).toContain(Frequency.ANNUALLY);
  });

  it("assigns every template a role, never a person", () => {
    for (const entry of catalog) {
      expect(entry.defaultAssigneeRole).toBeTruthy();
      // Roles are job titles (audit §6.10); a person's name would break
      // per-client assignee resolution.
      expect(entry.defaultAssigneeRole).not.toMatch(/@/);
    }
  });
});

describe("dedupeByTaskName", () => {
  it("keeps the first occurrence and drops later ones", () => {
    const first = BASIC_ACCOUNTING_TASKS[0]!;
    const duplicate = { ...first, description: "second copy" };
    const result = dedupeByTaskName([first, duplicate]);

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe(first.description);
  });

  it("is a no-op against the current catalog (audit D6)", () => {
    const all = [
      ...BASIC_ACCOUNTING_TASKS,
      ...FULL_FINANCE_ADDITIONAL_TASKS,
      ...CFO_FPA_ADDITIONAL_TASKS,
    ];
    expect(dedupeByTaskName(all)).toHaveLength(all.length);
  });
});
