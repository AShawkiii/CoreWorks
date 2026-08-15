/**
 * Single source of truth for every data sheet's header row (column order + names).
 * No other file should ever index into a row by a hardcoded column number, or
 * reference a column name as a bare string — always go through col()/headerRow().
 *
 * Layout-only sheets (CONTROL_CENTER, CLIENT_DASHBOARD, TEAM_DASHBOARD,
 * MONTHLY_CLOSE_DASHBOARD, MANAGEMENT_REPORT, _CHART_SRC) are NOT data tables and
 * are intentionally absent here — their cell positions are defined in their own
 * builder files (apps-script/dashboards/*SheetBuilder.gs).
 *
 * SETTINGS is a hybrid sheet: SCHEMAS.SETTINGS covers only its key/value
 * "parameters" block (columns A-D). Its separate "enumerated lists" zone
 * (one column per enum, used as named-range dropdown sources) is laid out by
 * apps-script/config/SettingsSheetBuilder.gs using constants from Constants.gs,
 * not by this header-row mechanism.
 */
var SCHEMAS = {
  CLIENTS: [
    'Client ID', 'Client Name', 'Company Name', 'Industry', 'Business Type',
    'Start Date', 'Service Package', 'Account Manager', 'Backup Team Member',
    'Client Contact', 'Email', 'Phone', 'Accounting System', 'Reporting Frequency',
    'Month-End Closing Date', 'Contract Status', 'Priority', 'Client Health',
    'Simple Completion %', 'Weighted Completion %', 'Last Activity', 'Next Deadline', 'Notes'
  ],

  EMPLOYEES: [
    'Employee ID', 'Employee Name', 'Role', 'Department', 'Email',
    'Active?', 'Manager', 'Capacity', 'Notes'
  ],

  SERVICES: [
    'Service ID', 'Service Name', 'Category', 'Description', 'Active?'
  ],

  SERVICE_PACKAGES: [
    'Package ID', 'Package Name', 'Description', 'Included Service Areas', 'Active?'
  ],

  TASK_TEMPLATES: [
    'Template ID', 'Service Package', 'Service Area', 'Task Name', 'Description',
    'Frequency', 'Priority', 'Default Assignee', 'Typical Duration (Days)',
    'Required Client Input?', 'Active?'
  ],

  TASKS: [
    'Task ID', 'Client ID', 'Client Name', 'Service Area', 'Task Category',
    'Task Name', 'Description', 'Period', 'Frequency', 'Assigned To', 'Priority',
    'Status', 'Start Date', 'Due Date', 'Completion Date', 'Days Remaining',
    'Days Overdue', 'Waiting For', 'Client Dependency', 'Completion %', 'Reviewer',
    'Review Status', 'Notes', 'Created Date', 'Last Updated'
  ],

  // "Days Waiting Bucket" is a confirmed addition beyond the literal spec — see
  // architecture.md §9 and requirements.md "Confirmed deviations".
  CLIENT_REQUESTS: [
    'Request ID', 'Client ID', 'Client', 'Request', 'Requested Date', 'Required By',
    'Status', 'Days Waiting', 'Days Waiting Bucket', 'Priority', 'Assigned To',
    'Received Date', 'Notes'
  ],

  ISSUES: [
    'Issue ID', 'Client ID', 'Client', 'Issue', 'Category', 'Date Raised', 'Severity',
    'Assigned To', 'Status', 'Impact', 'Required Action', 'Deadline',
    'Resolution Date', 'Notes'
  ],

  ACTIVITY_LOG: [
    'Activity ID', 'Date', 'User', 'Client', 'Entity Type', 'Entity ID', 'Action',
    'Previous Value', 'New Value', 'Comment'
  ],

  // Columns 4-21 (Sales .. Final Approval) are the 18 "stage" columns — see
  // MONTHLY_CLOSE_STAGE_COLUMNS below.
  MONTHLY_CLOSE: [
    'Close ID', 'Client', 'Month', 'Sales', 'COGS', 'Expenses', 'Bank Reconciliation',
    'AP', 'AR', 'Inventory', 'Fixed Assets', 'Accruals', 'Prepayments', 'Payroll',
    'Intercompany', 'Trial Balance', 'P&L', 'Balance Sheet', 'Cash Flow',
    'Management Review', 'Final Approval', 'Close Status', 'Completion %'
  ],

  SETTINGS: [
    'Setting Category', 'Setting Key', 'Value', 'Description'
  ]
};

// The subset of MONTHLY_CLOSE columns that hold a per-stage status value
// (Not Started/In Progress/Completed/Blocked/Waiting Client). Completion % and
// Close Status are derived FROM these, so they're excluded.
var MONTHLY_CLOSE_STAGE_COLUMNS = SCHEMAS.MONTHLY_CLOSE.slice(3, 21);

/**
 * Returns the 1-based column index of `columnName` within `sheetKey`'s schema.
 * Throws if the sheet or column is unknown — a typo should fail loudly, not
 * silently return undefined and corrupt a row write.
 */
function col(sheetKey, columnName) {
  var headers = SCHEMAS[sheetKey];
  if (!headers) {
    throw new Error('col(): unknown sheet key "' + sheetKey + '"');
  }
  var index = headers.indexOf(columnName);
  if (index === -1) {
    throw new Error('col(): unknown column "' + columnName + '" on sheet "' + sheetKey + '"');
  }
  return index + 1;
}

/** Returns the full ordered header array for a sheet key. */
function headerRow(sheetKey) {
  var headers = SCHEMAS[sheetKey];
  if (!headers) {
    throw new Error('headerRow(): unknown sheet key "' + sheetKey + '"');
  }
  return headers.slice();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMAS: SCHEMAS,
    MONTHLY_CLOSE_STAGE_COLUMNS: MONTHLY_CLOSE_STAGE_COLUMNS,
    col: col,
    headerRow: headerRow
  };
}
