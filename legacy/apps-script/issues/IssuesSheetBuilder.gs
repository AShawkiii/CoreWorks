/**
 * ISSUES — problems/risks affecting client delivery. No computed columns —
 * surfacing of Critical/High/overdue/unresolved issues happens on the
 * Control Center (Stage 5-6 IssueLogic/Engine), not via a column here.
 */
function buildIssuesSheet() {
  var sheet = getOrCreateSheet('ISSUES');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'ISSUES');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('ISSUES', 'Client ID', maxRows), 'CLIENTS', 'Client ID', false);
  applyCrossSheetValidation(sheet, rangeFor('ISSUES', 'Client', maxRows), 'CLIENTS', 'Client Name', false);
  applyCrossSheetValidation(sheet, rangeFor('ISSUES', 'Assigned To', maxRows), 'EMPLOYEES', 'Employee Name', true);
  applyEnumValidation(sheet, rangeFor('ISSUES', 'Severity', maxRows), 'ISSUE_SEVERITY', false);
  applyEnumValidation(sheet, rangeFor('ISSUES', 'Status', maxRows), 'ISSUE_STATUS', false);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, rangeFor('ISSUES', 'Severity', maxRows), 'ISSUE_SEVERITY'))
    .concat(buildEnumColorRules(sheet, rangeFor('ISSUES', 'Status', maxRows), 'ISSUE_STATUS'))
  );
}
