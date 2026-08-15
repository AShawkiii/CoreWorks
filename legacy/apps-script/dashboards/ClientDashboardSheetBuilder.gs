/**
 * CLIENT_DASHBOARD — dropdown-driven single-client view (Phase 11).
 * Layout-only sheet; cell positions are defined here as CD_LAYOUT (see the
 * note in Schemas.gs about why dashboards aren't in SCHEMAS). Stage 2
 * (this file) builds the frame + the client picker; Stage 6
 * (dashboards/ClientDashboardEngine.gs) renders content into it whenever the
 * picker cell changes.
 */
var CD_LAYOUT = {
  TITLE_ROW: 1,
  SELECTOR_ROW: 2,
  SELECTOR_LABEL_CELL: 'A2',
  SELECTOR_VALUE_CELL: 'B2',

  INFO_TITLE_ROW: 4,
  INFO_FIELDS: ['Client', 'Account Manager', 'Service Package', 'Client Health', 'Simple Completion %', 'Weighted Completion %', 'Last Activity', 'Next Deadline'],
  INFO_START_ROW: 5,

  SUMMARY_TITLE_ROW: 14,
  SUMMARY_LABEL_ROW: 15,
  SUMMARY_VALUE_ROW: 16,
  SUMMARY_START_COL: 1,
  SUMMARY_COL_STRIDE: 2,
  SUMMARY_CARDS: ['Total', 'Completed', 'In Progress', 'Not Started', 'Waiting Client', 'Blocked', 'Overdue'],

  SERVICE_PROGRESS_TITLE_ROW: 18,
  SERVICE_PROGRESS_HEADER_ROW: 19,
  SERVICE_PROGRESS_HEADERS: ['Service Area', 'Completion %'],
  SERVICE_PROGRESS_MAX_ROWS: 15,

  CURRENT_TASKS_TITLE_ROW: 36,
  CURRENT_TASKS_HEADER_ROW: 37,
  CURRENT_TASKS_HEADERS: ['Task', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Days Remaining'],
  CURRENT_TASKS_MAX_ROWS: 40,

  REQUESTS_TITLE_ROW: 79,
  REQUESTS_HEADER_ROW: 80,
  REQUESTS_HEADERS: ['Request', 'Status', 'Days Waiting'],
  REQUESTS_MAX_ROWS: 15,

  ISSUES_TITLE_ROW: 97,
  ISSUES_HEADER_ROW: 98,
  ISSUES_HEADERS: ['Issue', 'Severity', 'Status'],
  ISSUES_MAX_ROWS: 15,

  DEADLINES_TITLE_ROW: 115,
  DEADLINES_HEADER_ROW: 116,
  DEADLINES_HEADERS: ['Task', 'Due Date', 'Days Remaining'],
  DEADLINES_MAX_ROWS: 10
};

function buildClientDashboardSheet() {
  var sheet = getOrCreateSheet('CLIENT_DASHBOARD');
  removeManagedProtections(sheet);

  sheet.getRange(CD_LAYOUT.TITLE_ROW, 1).setValue('CLIENT DASHBOARD').setFontSize(18).setFontWeight('bold');

  sheet.getRange(CD_LAYOUT.SELECTOR_LABEL_CELL).setValue('Select Client:').setFontWeight('bold');
  applyCrossSheetValidation(sheet, CD_LAYOUT.SELECTOR_VALUE_CELL, 'CLIENTS', 'Client Name', false);
  sheet.getRange(CD_LAYOUT.SELECTOR_VALUE_CELL).setBackground('#fff3cd').setFontWeight('bold');

  writeSectionHeader(sheet, CD_LAYOUT.INFO_TITLE_ROW, 'CLIENT INFORMATION');
  CD_LAYOUT.INFO_FIELDS.forEach(function (label, i) {
    sheet.getRange(CD_LAYOUT.INFO_START_ROW + i, 1).setValue(label).setFontWeight('bold');
  });

  writeSectionHeader(sheet, CD_LAYOUT.SUMMARY_TITLE_ROW, 'TASK SUMMARY');
  CD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    var colIndex = CD_LAYOUT.SUMMARY_START_COL + i * CD_LAYOUT.SUMMARY_COL_STRIDE;
    sheet.getRange(CD_LAYOUT.SUMMARY_LABEL_ROW, colIndex).setValue(label).setFontWeight('bold').setFontSize(9).setFontColor('#555555');
    sheet.getRange(CD_LAYOUT.SUMMARY_VALUE_ROW, colIndex).setFontSize(16).setFontWeight('bold');
  });

  writeSectionHeader(sheet, CD_LAYOUT.SERVICE_PROGRESS_TITLE_ROW, 'SERVICE PROGRESS');
  writeTableHeaders(sheet, CD_LAYOUT.SERVICE_PROGRESS_HEADER_ROW, CD_LAYOUT.SERVICE_PROGRESS_HEADERS);

  writeSectionHeader(sheet, CD_LAYOUT.CURRENT_TASKS_TITLE_ROW, 'CURRENT TASKS');
  writeTableHeaders(sheet, CD_LAYOUT.CURRENT_TASKS_HEADER_ROW, CD_LAYOUT.CURRENT_TASKS_HEADERS);

  writeSectionHeader(sheet, CD_LAYOUT.REQUESTS_TITLE_ROW, 'CLIENT REQUESTS');
  writeTableHeaders(sheet, CD_LAYOUT.REQUESTS_HEADER_ROW, CD_LAYOUT.REQUESTS_HEADERS);

  writeSectionHeader(sheet, CD_LAYOUT.ISSUES_TITLE_ROW, 'ISSUES');
  writeTableHeaders(sheet, CD_LAYOUT.ISSUES_HEADER_ROW, CD_LAYOUT.ISSUES_HEADERS);

  writeSectionHeader(sheet, CD_LAYOUT.DEADLINES_TITLE_ROW, 'UPCOMING DEADLINES (next 10)');
  writeTableHeaders(sheet, CD_LAYOUT.DEADLINES_HEADER_ROW, CD_LAYOUT.DEADLINES_HEADERS);

  sheet.setFrozenRows(CD_LAYOUT.SELECTOR_ROW);
}
