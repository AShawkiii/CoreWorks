/**
 * TEAM_DASHBOARD — per-employee workload (Phase 12). Layout-only sheet;
 * Stage 6 (dashboards/TeamDashboardEngine.gs) writes one row per employee.
 */
var TD_LAYOUT = {
  TITLE_ROW: 1,
  HEADER_ROW: 3,
  START_ROW: 4,
  MAX_ROWS: 30,
  HEADERS: [
    'Employee', 'Role', 'Assigned Tasks', 'Completed', 'In Progress', 'Overdue',
    'Waiting Client', 'Critical', 'Completion %', 'Capacity', 'Workload Status'
  ]
};

function buildTeamDashboardSheet() {
  var sheet = getOrCreateSheet('TEAM_DASHBOARD');
  removeManagedProtections(sheet);

  sheet.getRange(TD_LAYOUT.TITLE_ROW, 1).setValue('TEAM DASHBOARD').setFontSize(18).setFontWeight('bold');
  writeTableHeaders(sheet, TD_LAYOUT.HEADER_ROW, TD_LAYOUT.HEADERS);

  var dataRange = 'K' + TD_LAYOUT.START_ROW + ':K' + (TD_LAYOUT.START_ROW + TD_LAYOUT.MAX_ROWS);
  applyListValidation(sheet, dataRange, ['OK', 'Overloaded'], true);
  resetConditionalFormatting(sheet, [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Overloaded')
      .setBackground('#f8d7da').setFontColor('#842029')
      .setRanges([sheet.getRange(dataRange)])
      .build()
  ]);

  protectRange(sheet, 'A' + TD_LAYOUT.START_ROW + ':K' + (TD_LAYOUT.START_ROW + TD_LAYOUT.MAX_ROWS), 'Team dashboard computed rows');
  sheet.setFrozenRows(TD_LAYOUT.HEADER_ROW);
}
