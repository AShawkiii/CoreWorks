/**
 * TASK_TEMPLATE_SEED — the actual Basic Accounting / Full Finance / CFO-FP&A
 * catalog content (Phase 5). Each service package tier gets its OWN full set
 * of template rows (not a reference to a shared row) because TASK_TEMPLATES
 * is queried by an exact Service Package match at generation time
 * (templates/TaskTemplateService.gs::getActiveTemplatesForPackage) — see
 * architecture.md for why templates aren't cross-referenced instead.
 *
 * PROFESSIONAL ASSUMPTION (documented per the master prompt's instruction to
 * flag non-architectural judgment calls): the spec states "Full Finance =
 * everything in Basic Accounting, plus: ..." explicitly, but for CFO/FP&A it
 * only says "Include: ...9 items..." without restating inheritance. Since
 * CFO/FP&A is the top-tier package, it is built here as Full Finance's full
 * 16 tasks PLUS the CFO-specific items, with the 3 CFO-list items that
 * already exist in Full Finance (Budget, Cash Forecast, Management
 * Reporting) deduplicated by name rather than re-added as second rows.
 */

var BASIC_ACCOUNTING_TASKS = [
  { serviceArea: 'Bookkeeping', taskName: 'Daily Bookkeeping', description: 'Record day-to-day transactions in the accounting system.', frequency: 'Daily', priority: 'Medium', role: 'Bookkeeper', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Bank Reconciliation', taskName: 'Bank Reconciliation', description: 'Reconcile bank statements against the general ledger for the period.', frequency: 'Monthly', priority: 'High', role: 'Bookkeeper', durationDays: 2, requiresClientInput: 'Yes' },
  { serviceArea: 'Accounts Payable', taskName: 'AP', description: 'Process and reconcile accounts payable for the period.', frequency: 'Monthly', priority: 'Medium', role: 'Bookkeeper', durationDays: 2, requiresClientInput: 'Yes' },
  { serviceArea: 'Accounts Receivable', taskName: 'AR', description: 'Process and reconcile accounts receivable for the period.', frequency: 'Monthly', priority: 'Medium', role: 'Bookkeeper', durationDays: 2, requiresClientInput: 'Yes' },
  { serviceArea: 'General Ledger', taskName: 'GL Review', description: 'Review general ledger entries for accuracy and completeness.', frequency: 'Monthly', priority: 'High', role: 'Senior Accountant', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Month-End Closing', taskName: 'Month-End Close', description: 'Complete the month-end close checklist across all ledgers.', frequency: 'Monthly', priority: 'Critical', role: 'Senior Accountant', durationDays: 3, requiresClientInput: 'Yes' },
  { serviceArea: 'P&L', taskName: 'Monthly P&L', description: 'Prepare the monthly profit & loss statement.', frequency: 'Monthly', priority: 'High', role: 'Senior Accountant', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Balance Sheet', taskName: 'Monthly Balance Sheet', description: 'Prepare the monthly balance sheet.', frequency: 'Monthly', priority: 'High', role: 'Senior Accountant', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Cash Flow', taskName: 'Monthly Cash Flow', description: 'Prepare the monthly cash flow statement.', frequency: 'Monthly', priority: 'High', role: 'Senior Accountant', durationDays: 1, requiresClientInput: 'No' }
];

var FULL_FINANCE_ADDITIONAL_TASKS = [
  { serviceArea: 'Budgeting', taskName: 'Budget', description: 'Build the annual operating budget with the client.', frequency: 'Annually', priority: 'High', role: 'FP&A Analyst', durationDays: 5, requiresClientInput: 'Yes' },
  { serviceArea: 'Sales Forecasting', taskName: 'Sales Forecast', description: 'Update the rolling sales forecast.', frequency: 'Monthly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 2, requiresClientInput: 'Yes' },
  { serviceArea: 'Cash Forecasting', taskName: 'Cash Forecast', description: 'Update the short-term cash forecast.', frequency: 'Monthly', priority: 'High', role: 'FP&A Analyst', durationDays: 2, requiresClientInput: 'Yes' },
  { serviceArea: 'Budget vs Actual', taskName: 'Budget vs Actual', description: "Compare actual results to budget for the period.", frequency: 'Monthly', priority: 'High', role: 'FP&A Analyst', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'KPI Reporting', taskName: 'KPI Reporting', description: "Update the client's KPI dashboard.", frequency: 'Monthly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Variance Analysis', taskName: 'Variance Analysis', description: 'Analyze variances between actual and planned results.', frequency: 'Monthly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Management Reporting', taskName: 'Management Reporting', description: 'Prepare the monthly management report package.', frequency: 'Monthly', priority: 'High', role: 'Account Manager', durationDays: 2, requiresClientInput: 'No' }
];

var CFO_FPA_ADDITIONAL_TASKS = [
  { serviceArea: 'Forecasting', taskName: 'Rolling Forecast', description: 'Refresh the rolling forecast for the next four quarters.', frequency: 'Quarterly', priority: 'High', role: 'FP&A Analyst', durationDays: 3, requiresClientInput: 'Yes' },
  { serviceArea: 'Scenario Analysis', taskName: 'Scenario Analysis', description: 'Model best/base/worst-case financial scenarios.', frequency: 'Quarterly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 3, requiresClientInput: 'Yes' },
  { serviceArea: 'KPI Reporting', taskName: 'KPI Dashboard', description: 'Maintain the executive KPI dashboard.', frequency: 'Monthly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 1, requiresClientInput: 'No' },
  { serviceArea: 'Profitability Analysis', taskName: 'Profitability Analysis', description: 'Analyze profitability by product, service, or segment.', frequency: 'Quarterly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 2, requiresClientInput: 'No' },
  { serviceArea: 'Business Planning', taskName: 'Working Capital Analysis', description: 'Analyze working capital trends and recommend improvements.', frequency: 'Quarterly', priority: 'Medium', role: 'FP&A Analyst', durationDays: 2, requiresClientInput: 'No' },
  { serviceArea: 'Business Planning', taskName: 'Strategic Recommendations', description: 'Prepare strategic recommendations for management review.', frequency: 'Quarterly', priority: 'High', role: 'CFO Advisor', durationDays: 3, requiresClientInput: 'No' }
];

/** Builds the full seed array: one row per (task, package-tier) pair, with a stable-but-arbitrary Template ID assigned sequentially at seed time (see TaskTemplateService.gs::seedTaskTemplates). */
function buildTaskTemplateSeed() {
  var basicAccountingSeed = BASIC_ACCOUNTING_TASKS.map(function (t) { return withPackage(t, 'Basic Accounting'); });

  var fullFinanceTasks = BASIC_ACCOUNTING_TASKS.concat(FULL_FINANCE_ADDITIONAL_TASKS);
  var fullFinanceSeed = fullFinanceTasks.map(function (t) { return withPackage(t, 'Full Finance'); });

  var cfoFpaTasks = dedupeByTaskName(fullFinanceTasks.concat(CFO_FPA_ADDITIONAL_TASKS));
  var cfoFpaSeed = cfoFpaTasks.map(function (t) { return withPackage(t, 'CFO / FP&A'); });

  return basicAccountingSeed.concat(fullFinanceSeed).concat(cfoFpaSeed);
}

function withPackage(task, servicePackage) {
  var copy = Object.assign({}, task);
  copy.servicePackage = servicePackage;
  return copy;
}

function dedupeByTaskName(tasks) {
  var seen = {};
  return tasks.filter(function (t) {
    if (seen[t.taskName]) return false;
    seen[t.taskName] = true;
    return true;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BASIC_ACCOUNTING_TASKS: BASIC_ACCOUNTING_TASKS,
    FULL_FINANCE_ADDITIONAL_TASKS: FULL_FINANCE_ADDITIONAL_TASKS,
    CFO_FPA_ADDITIONAL_TASKS: CFO_FPA_ADDITIONAL_TASKS,
    buildTaskTemplateSeed: buildTaskTemplateSeed,
    dedupeByTaskName: dedupeByTaskName
  };
}
