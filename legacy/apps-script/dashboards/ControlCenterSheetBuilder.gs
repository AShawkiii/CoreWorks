/**
 * CONTROL_CENTER — management dashboard. This is a LAYOUT-ONLY sheet (not a
 * data table), so its cell positions are defined here as CC_LAYOUT rather
 * than in Schemas.gs (see the note at the top of Schemas.gs).
 *
 * Stage 2 (this file) builds the frame: title, KPI card labels, Client
 * Health Table header, and a reserved charts area. Stage 6
 * (dashboards/DashboardQueryUtils.gs, Charts.gs) fills in the KPI formulas,
 * the health table QUERY, and the 6 charts — using these same CC_LAYOUT
 * cell references, so this file's structure must stay stable once Stage 6
 * builds on it.
 */
var CC_LAYOUT = {
  TITLE_ROW: 1,
  SUBTITLE_ROW: 2,
  KPI_LABEL_ROW: 4,
  KPI_VALUE_ROW: 5,
  KPI_START_COL: 1,      // A
  KPI_COL_STRIDE: 2,     // one blank spacer column between each KPI card
  KPI_CARDS: [
    'Total Clients', 'Active Clients', 'Onboarding', 'On Hold', 'Overall Completion %',
    'Open Tasks', 'Overdue Tasks', 'Waiting Client', 'Blocked Tasks'
  ],
  HEALTH_TABLE_TITLE_ROW: 7,
  HEALTH_TABLE_HEADER_ROW: 8,
  HEALTH_TABLE_START_ROW: 9,
  HEALTH_TABLE_HEADERS: ['Client', 'Account Manager', 'Progress', 'Open Tasks', 'Overdue', 'Waiting Client', 'Next Deadline', 'Health'],
  HEALTH_TABLE_MAX_ROWS: 120,
  ISSUES_TITLE_ROW: 132,
  ISSUES_HEADER_ROW: 133,
  ISSUES_HEADERS: ['Client', 'Issue', 'Severity', 'Status', 'Deadline'],
  ISSUES_MAX_ROWS: 20,
  CHARTS_TITLE_ROW: 156,
  CHARTS_START_ROW: 158,
  CHART_ROW_SPAN: 18,
  CHART_COL_SPAN: 8,
  CHART_TITLES: [
    'Client Progress', 'Tasks by Status', 'Tasks by Employee',
    'Overdue Tasks by Client', 'Client Health Distribution', 'Employee Workload'
  ]
};

function buildControlCenterSheet() {
  var sheet = getOrCreateSheet('CONTROL_CENTER');

  sheet.getRange(CC_LAYOUT.TITLE_ROW, 1).setValue('FINANCE LAB — CONTROL CENTER')
    .setFontSize(18).setFontWeight('bold');
  sheet.getRange(CC_LAYOUT.SUBTITLE_ROW, 1)
    .setValue('Management overview — all clients, tasks, and operational risk in one place.')
    .setFontStyle('italic').setFontColor('#555555');

  writeKpiCardLabels(sheet);
  writeSectionHeader(sheet, CC_LAYOUT.HEALTH_TABLE_TITLE_ROW, 'CLIENT HEALTH');
  writeTableHeaders(sheet, CC_LAYOUT.HEALTH_TABLE_HEADER_ROW, CC_LAYOUT.HEALTH_TABLE_HEADERS);

  writeSectionHeader(sheet, CC_LAYOUT.ISSUES_TITLE_ROW, 'ISSUES REQUIRING ATTENTION (Critical / High / Overdue)');
  writeTableHeaders(sheet, CC_LAYOUT.ISSUES_HEADER_ROW, CC_LAYOUT.ISSUES_HEADERS);

  writeSectionHeader(sheet, CC_LAYOUT.CHARTS_TITLE_ROW, 'CHARTS');

  sheet.setFrozenRows(CC_LAYOUT.KPI_VALUE_ROW);
}

function writeKpiCardLabels(sheet) {
  CC_LAYOUT.KPI_CARDS.forEach(function (label, i) {
    var colIndex = CC_LAYOUT.KPI_START_COL + i * CC_LAYOUT.KPI_COL_STRIDE;
    sheet.getRange(CC_LAYOUT.KPI_LABEL_ROW, colIndex).setValue(label)
      .setFontWeight('bold').setFontSize(9).setFontColor('#555555');
    sheet.getRange(CC_LAYOUT.KPI_VALUE_ROW, colIndex).setFontSize(20).setFontWeight('bold');
  });
}

/**
 * Writes the 9 KPI-card formulas (Phase 10). Simple single-sheet aggregates
 * only — always fresh with no script run needed — so management sees these
 * the instant the sheet opens even if nothing has triggered a recalculation.
 */
function buildControlCenterKpiFormulas() {
  var sheet = getSheet('CONTROL_CENTER');
  var formulas = {
    'Total Clients': '=COUNTA(CLIENTS!' + rangeFor('CLIENTS', 'Client ID', CONST.MAX_DATA_ROWS) + ')',
    'Active Clients': countifFormula('CLIENTS', 'Contract Status', 'Active'),
    'Onboarding': countifFormula('CLIENTS', 'Contract Status', 'Onboarding'),
    'On Hold': countifFormula('CLIENTS', 'Contract Status', 'On Hold'),
    'Overall Completion %': averageFormula('CLIENTS', 'Weighted Completion %'),
    'Open Tasks': countifsFormula('TASKS', [
      { column: 'Task ID', criteria: '<>' },
      { column: 'Status', criteria: '<>Completed' },
      { column: 'Status', criteria: '<>Cancelled' }
    ]),
    'Overdue Tasks': countifFormula('TASKS', 'Days Overdue', '>0'),
    'Waiting Client': countifFormula('TASKS', 'Status', 'Waiting Client'),
    'Blocked Tasks': countifFormula('TASKS', 'Status', 'Blocked')
  };

  CC_LAYOUT.KPI_CARDS.forEach(function (label, i) {
    var colIndex = CC_LAYOUT.KPI_START_COL + i * CC_LAYOUT.KPI_COL_STRIDE;
    var cell = sheet.getRange(CC_LAYOUT.KPI_VALUE_ROW, colIndex);
    cell.setFormula(formulas[label]);
    if (label === 'Overall Completion %') cell.setNumberFormat('0%');
  });
}
