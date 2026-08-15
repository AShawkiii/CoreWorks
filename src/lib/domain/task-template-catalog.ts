/**
 * Default task-template catalog.
 *
 * Transcribed verbatim from legacy `templates/TaskTemplatesData.gs`
 * (audit §6.12). This is business content, not invented sample data — it is
 * the firm's actual service catalog, and the tier composition rules are the
 * legacy ones.
 *
 * Composition (verified by executing the legacy builder, audit defect D6):
 *   Basic Accounting  9
 *   Full Finance      9 + 7  = 16
 *   CFO / FP&A       16 + 6  = 22   (dedupeByTaskName is a no-op here)
 *   ---------------------------------
 *   Total seed rows           47
 */

import { Frequency, Priority } from "@/generated/prisma/enums";

export interface TemplateDefinition {
  readonly serviceArea: string;
  readonly taskName: string;
  readonly description: string;
  readonly frequency: Frequency;
  readonly priority: Priority;
  /** A ROLE, resolved to a person per client at generation time (audit §6.10). */
  readonly defaultAssigneeRole: string;
  readonly typicalDurationDays: number;
  readonly requiresClientInput: boolean;
}

export const BASIC_ACCOUNTING_TASKS: readonly TemplateDefinition[] = [
  {
    serviceArea: "Bookkeeping",
    taskName: "Daily Bookkeeping",
    description: "Record day-to-day transactions in the accounting system.",
    frequency: Frequency.DAILY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "Bookkeeper",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Bank Reconciliation",
    taskName: "Bank Reconciliation",
    description:
      "Reconcile bank statements against the general ledger for the period.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Bookkeeper",
    typicalDurationDays: 2,
    requiresClientInput: true,
  },
  {
    serviceArea: "Accounts Payable",
    taskName: "AP",
    description: "Process and reconcile accounts payable for the period.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "Bookkeeper",
    typicalDurationDays: 2,
    requiresClientInput: true,
  },
  {
    serviceArea: "Accounts Receivable",
    taskName: "AR",
    description: "Process and reconcile accounts receivable for the period.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "Bookkeeper",
    typicalDurationDays: 2,
    requiresClientInput: true,
  },
  {
    serviceArea: "General Ledger",
    taskName: "GL Review",
    description: "Review general ledger entries for accuracy and completeness.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Senior Accountant",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Month-End Closing",
    taskName: "Month-End Close",
    description: "Complete the month-end close checklist across all ledgers.",
    frequency: Frequency.MONTHLY,
    priority: Priority.CRITICAL,
    defaultAssigneeRole: "Senior Accountant",
    typicalDurationDays: 3,
    requiresClientInput: true,
  },
  {
    serviceArea: "P&L",
    taskName: "Monthly P&L",
    description: "Prepare the monthly profit & loss statement.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Senior Accountant",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Balance Sheet",
    taskName: "Monthly Balance Sheet",
    description: "Prepare the monthly balance sheet.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Senior Accountant",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Cash Flow",
    taskName: "Monthly Cash Flow",
    description: "Prepare the monthly cash flow statement.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Senior Accountant",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
];

export const FULL_FINANCE_ADDITIONAL_TASKS: readonly TemplateDefinition[] = [
  {
    serviceArea: "Budgeting",
    taskName: "Budget",
    description: "Build the annual operating budget with the client.",
    frequency: Frequency.ANNUALLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 5,
    requiresClientInput: true,
  },
  {
    serviceArea: "Sales Forecasting",
    taskName: "Sales Forecast",
    description: "Update the rolling sales forecast.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 2,
    requiresClientInput: true,
  },
  {
    serviceArea: "Cash Forecasting",
    taskName: "Cash Forecast",
    description: "Update the short-term cash forecast.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 2,
    requiresClientInput: true,
  },
  {
    serviceArea: "Budget vs Actual",
    taskName: "Budget vs Actual",
    description: "Compare actual results to budget for the period.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "KPI Reporting",
    taskName: "KPI Reporting",
    description: "Update the client's KPI dashboard.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Variance Analysis",
    taskName: "Variance Analysis",
    description: "Analyze variances between actual and planned results.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Management Reporting",
    taskName: "Management Reporting",
    description: "Prepare the monthly management report package.",
    frequency: Frequency.MONTHLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "Account Manager",
    typicalDurationDays: 2,
    requiresClientInput: false,
  },
];

export const CFO_FPA_ADDITIONAL_TASKS: readonly TemplateDefinition[] = [
  {
    serviceArea: "Forecasting",
    taskName: "Rolling Forecast",
    description: "Refresh the rolling forecast for the next four quarters.",
    frequency: Frequency.QUARTERLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 3,
    requiresClientInput: true,
  },
  {
    serviceArea: "Scenario Analysis",
    taskName: "Scenario Analysis",
    description: "Model best/base/worst-case financial scenarios.",
    frequency: Frequency.QUARTERLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 3,
    requiresClientInput: true,
  },
  {
    serviceArea: "KPI Reporting",
    taskName: "KPI Dashboard",
    description: "Maintain the executive KPI dashboard.",
    frequency: Frequency.MONTHLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 1,
    requiresClientInput: false,
  },
  {
    serviceArea: "Profitability Analysis",
    taskName: "Profitability Analysis",
    description: "Analyze profitability by product, service, or segment.",
    frequency: Frequency.QUARTERLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 2,
    requiresClientInput: false,
  },
  {
    serviceArea: "Business Planning",
    taskName: "Working Capital Analysis",
    description:
      "Analyze working capital trends and recommend improvements.",
    frequency: Frequency.QUARTERLY,
    priority: Priority.MEDIUM,
    defaultAssigneeRole: "FP&A Analyst",
    typicalDurationDays: 2,
    requiresClientInput: false,
  },
  {
    serviceArea: "Business Planning",
    taskName: "Strategic Recommendations",
    description: "Prepare strategic recommendations for management review.",
    frequency: Frequency.QUARTERLY,
    priority: Priority.HIGH,
    defaultAssigneeRole: "CFO Advisor",
    typicalDurationDays: 3,
    requiresClientInput: false,
  },
];

export const SERVICE_PACKAGE_NAMES = {
  BASIC_ACCOUNTING: "Basic Accounting",
  FULL_FINANCE: "Full Finance",
  CFO_FPA: "CFO / FP&A",
} as const;

/**
 * Legacy `dedupeByTaskName` — keeps the FIRST occurrence of each task name.
 *
 * Against the current catalog this removes nothing (audit D6), but it is
 * ported because it is a real guard if the catalog is later edited: without
 * it, adding an already-present task name to the CFO tier would silently
 * produce two template rows and therefore two generated tasks per period.
 */
export function dedupeByTaskName(
  templates: readonly TemplateDefinition[],
): TemplateDefinition[] {
  const seen = new Set<string>();
  return templates.filter((template) => {
    if (seen.has(template.taskName)) return false;
    seen.add(template.taskName);
    return true;
  });
}

export interface CatalogEntry extends TemplateDefinition {
  readonly servicePackage: string;
}

/** Legacy `buildTaskTemplateSeed()` — one row per (task, package) pair. */
export function buildTaskTemplateCatalog(): CatalogEntry[] {
  const withPackage = (
    templates: readonly TemplateDefinition[],
    servicePackage: string,
  ): CatalogEntry[] =>
    templates.map((template) => ({ ...template, servicePackage }));

  const fullFinanceTasks = [
    ...BASIC_ACCOUNTING_TASKS,
    ...FULL_FINANCE_ADDITIONAL_TASKS,
  ];

  const cfoTasks = dedupeByTaskName([
    ...fullFinanceTasks,
    ...CFO_FPA_ADDITIONAL_TASKS,
  ]);

  return [
    ...withPackage(
      BASIC_ACCOUNTING_TASKS,
      SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING,
    ),
    ...withPackage(fullFinanceTasks, SERVICE_PACKAGE_NAMES.FULL_FINANCE),
    ...withPackage(cfoTasks, SERVICE_PACKAGE_NAMES.CFO_FPA),
  ];
}

/** Distinct service areas across the catalog, used to seed SERVICES. */
export function catalogServiceAreas(): string[] {
  const areas = new Set<string>();
  for (const entry of buildTaskTemplateCatalog()) areas.add(entry.serviceArea);
  return [...areas].sort();
}
