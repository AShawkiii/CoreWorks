/**
 * MONTHLY_CLOSE_DASHBOARD — client + month filtered close status view
 * (Phase 13). Layout-only sheet; Stage 6
 * (dashboards/MonthlyCloseDashboardEngine.gs) renders content whenever the
 * filters change. The 18 stage columns are laid out horizontally as a
 * visual strip, colored by CLOSE_STAGE_STATUS (mirrors MONTHLY_CLOSE's own
 * conditional formatting) so a manager can see closing progress at a glance.
 */
var MCD_LAYOUT = {
  TITLE_ROW: 1,
  FILTER_ROW: 2,
  CLIENT_FILTER_LABEL_CELL: 'A2',
  CLIENT_FILTER_VALUE_CELL: 'B2',
  MONTH_FILTER_LABEL_CELL: 'D2',
  MONTH_FILTER_VALUE_CELL: 'E2',

  SUMMARY_TITLE_ROW: 4,
  SUMMARY_LABEL_ROW: 5,
  SUMMARY_VALUE_ROW: 6,
  SUMMARY_START_COL: 1,
  SUMMARY_COL_STRIDE: 2,
  SUMMARY_CARDS: ['Completion %', 'Completed', 'Pending', 'Overdue', 'Waiting Client', 'Blocked'],

  STAGES_TITLE_ROW: 8,
  STAGES_HEADER_ROW: 9,
  STAGES_VALUE_ROW: 10
};

function buildMonthlyCloseDashboardSheet() {
  var sheet = getOrCreateSheet('MONTHLY_CLOSE_DASHBOARD');
  removeManagedProtections(sheet);

  sheet.getRange(MCD_LAYOUT.TITLE_ROW, 1).setValue('MONTHLY CLOSE DASHBOARD').setFontSize(18).setFontWeight('bold');

  sheet.getRange(MCD_LAYOUT.CLIENT_FILTER_LABEL_CELL).setValue('Client:').setFontWeight('bold');
  applyCrossSheetValidation(sheet, MCD_LAYOUT.CLIENT_FILTER_VALUE_CELL, 'CLIENTS', 'Client Name', false);
  sheet.getRange(MCD_LAYOUT.CLIENT_FILTER_VALUE_CELL).setBackground('#fff3cd').setFontWeight('bold');

  sheet.getRange(MCD_LAYOUT.MONTH_FILTER_LABEL_CELL).setValue('Month (YYYY-MM):').setFontWeight('bold');
  sheet.getRange(MCD_LAYOUT.MONTH_FILTER_VALUE_CELL).setBackground('#fff3cd').setFontWeight('bold');

  writeSectionHeader(sheet, MCD_LAYOUT.SUMMARY_TITLE_ROW, 'CLOSE SUMMARY');
  MCD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    var colIndex = MCD_LAYOUT.SUMMARY_START_COL + i * MCD_LAYOUT.SUMMARY_COL_STRIDE;
    sheet.getRange(MCD_LAYOUT.SUMMARY_LABEL_ROW, colIndex).setValue(label).setFontWeight('bold').setFontSize(9).setFontColor('#555555');
    sheet.getRange(MCD_LAYOUT.SUMMARY_VALUE_ROW, colIndex).setFontSize(16).setFontWeight('bold');
  });

  writeSectionHeader(sheet, MCD_LAYOUT.STAGES_TITLE_ROW, 'CLOSING STAGES');
  var stageHeaderRange = sheet.getRange(MCD_LAYOUT.STAGES_HEADER_ROW, 1, 1, MONTHLY_CLOSE_STAGE_COLUMNS.length);
  stageHeaderRange.setValues([MONTHLY_CLOSE_STAGE_COLUMNS]);
  stageHeaderRange.setFontWeight('bold').setFontSize(9).setBackground('#374151').setFontColor('#ffffff').setWrap(true);

  var stageValueRange = sheet.getRange(MCD_LAYOUT.STAGES_VALUE_ROW, 1, 1, MONTHLY_CLOSE_STAGE_COLUMNS.length);
  resetConditionalFormatting(sheet, buildEnumColorRules(sheet, stageValueRange.getA1Notation(), 'CLOSE_STAGE_STATUS'));

  sheet.setFrozenRows(MCD_LAYOUT.FILTER_ROW);
}
