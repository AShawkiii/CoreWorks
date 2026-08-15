/**
 * SERVICES — the editable Finance Lab service catalog. Content (the actual
 * 20+ service rows) is seeded by config/Setup.gs's seedServicesCatalog()
 * call so the catalog exists before TASK_TEMPLATES references it.
 */
function buildServicesSheet() {
  var sheet = getOrCreateSheet('SERVICES');
  writeHeaderRow(sheet, 'SERVICES');

  var activeRange = 'E2:E' + CONST.MAX_DATA_ROWS;
  applyEnumValidation(sheet, activeRange, 'ACTIVE_FLAG', false);
  resetConditionalFormatting(sheet, buildEnumColorRules(sheet, activeRange, 'ACTIVE_FLAG'));

  seedServicesCatalog(sheet);
}

/** Finance Lab's standard service catalog (from the company service list). Idempotent: only appends services not already present by name. */
function seedServicesCatalog(sheet) {
  var catalog = [
    ['Bookkeeping', 'Accounting'],
    ['General Ledger', 'Accounting'],
    ['Accounts Payable', 'Accounting'],
    ['Accounts Receivable', 'Accounting'],
    ['Bank Reconciliation', 'Accounting'],
    ['Inventory', 'Accounting'],
    ['Fixed Assets', 'Accounting'],
    ['Payroll', 'Accounting'],
    ['Month-End Closing', 'Close & Reporting'],
    ['P&L', 'Close & Reporting'],
    ['Balance Sheet', 'Close & Reporting'],
    ['Cash Flow', 'Close & Reporting'],
    ['Budgeting', 'FP&A'],
    ['Sales Forecasting', 'FP&A'],
    ['Cash Forecasting', 'FP&A'],
    ['Budget vs Actual', 'FP&A'],
    ['Variance Analysis', 'FP&A'],
    ['KPI Reporting', 'FP&A'],
    ['Management Reporting', 'FP&A'],
    ['Financial Planning & Analysis', 'FP&A'],
    ['Investment Analysis', 'Advisory'],
    ['Financial Modeling', 'Advisory'],
    ['Business Planning', 'Advisory'],
    ['Profitability Analysis', 'Advisory']
  ];

  var existing = getAllRows('SERVICES');
  var existingNames = {};
  existing.forEach(function (r) { existingNames[r['Service Name']] = true; });
  var existingIds = existing.map(function (r) { return r['Service ID']; });

  var rowsToAppend = [];
  catalog.forEach(function (entry) {
    var name = entry[0], category = entry[1];
    if (existingNames[name]) return;
    var id = nextSequentialId(existingIds, 'SVC-', 3);
    existingIds.push(id);
    rowsToAppend.push({
      'Service ID': id,
      'Service Name': name,
      'Category': category,
      'Description': name + ' services provided by Finance Lab.',
      'Active?': 'Yes'
    });
  });

  if (rowsToAppend.length) appendRows('SERVICES', rowsToAppend);
}
