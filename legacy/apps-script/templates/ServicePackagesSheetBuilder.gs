/**
 * SERVICE_PACKAGES — the sellable bundles clients are assigned to. Additional
 * packages can be added as new rows at any time (Phase spec: "Allow
 * additional packages later"); TASK_TEMPLATES.Service Package just needs to
 * match a Package Name here.
 */
function buildServicePackagesSheet() {
  var sheet = getOrCreateSheet('SERVICE_PACKAGES');
  writeHeaderRow(sheet, 'SERVICE_PACKAGES');

  var activeRange = 'E2:E' + CONST.MAX_DATA_ROWS;
  applyEnumValidation(sheet, activeRange, 'ACTIVE_FLAG', false);
  resetConditionalFormatting(sheet, buildEnumColorRules(sheet, activeRange, 'ACTIVE_FLAG'));

  seedServicePackages(sheet);
}

function seedServicePackages(sheet) {
  var packages = [
    {
      'Package Name': 'Basic Accounting',
      'Description': 'Core day-to-day bookkeeping and monthly reporting.',
      'Included Service Areas': 'Bookkeeping, Bank Reconciliation, Accounts Payable, Accounts Receivable, General Ledger, Month-End Closing, P&L, Balance Sheet, Cash Flow'
    },
    {
      'Package Name': 'Full Finance',
      'Description': 'Basic Accounting plus budgeting, forecasting, and management reporting.',
      'Included Service Areas': 'Bookkeeping, Bank Reconciliation, Accounts Payable, Accounts Receivable, General Ledger, Month-End Closing, P&L, Balance Sheet, Cash Flow, Budgeting, Sales Forecasting, Cash Forecasting, Budget vs Actual, KPI Reporting, Variance Analysis, Management Reporting'
    },
    {
      'Package Name': 'CFO / FP&A',
      'Description': 'Full Finance plus strategic FP&A: rolling forecasts, scenario analysis, and profitability/working-capital advisory.',
      'Included Service Areas': 'Bookkeeping, Bank Reconciliation, Accounts Payable, Accounts Receivable, General Ledger, Month-End Closing, P&L, Balance Sheet, Cash Flow, Budgeting, Rolling Forecast, Cash Forecasting, Scenario Analysis, KPI Reporting, Profitability Analysis, Business Planning, Management Reporting'
    }
  ];

  var existing = getAllRows('SERVICE_PACKAGES');
  var existingNames = {};
  existing.forEach(function (r) { existingNames[r['Package Name']] = true; });
  var existingIds = existing.map(function (r) { return r['Package ID']; });

  var rowsToAppend = [];
  packages.forEach(function (pkg) {
    if (existingNames[pkg['Package Name']]) return;
    var id = nextSequentialId(existingIds, 'PKG-', 3);
    existingIds.push(id);
    rowsToAppend.push({
      'Package ID': id,
      'Package Name': pkg['Package Name'],
      'Description': pkg['Description'],
      'Included Service Areas': pkg['Included Service Areas'],
      'Active?': 'Yes'
    });
  });

  if (rowsToAppend.length) appendRows('SERVICE_PACKAGES', rowsToAppend);
}
