/**
 * EMPLOYEES — staff directory. Placed under clients/ (not a dedicated
 * "team" folder) since employee records are consumed primarily by
 * client-assignment and task-generation logic; see architecture.md.
 * Fully editable — no computed columns, so no protection is applied here.
 */
function buildEmployeesSheet() {
  var sheet = getOrCreateSheet('EMPLOYEES');
  writeHeaderRow(sheet, 'EMPLOYEES');

  var dataRange = 'F2:F' + CONST.MAX_DATA_ROWS; // Active?
  applyEnumValidation(sheet, dataRange, 'ACTIVE_FLAG', false);

  resetConditionalFormatting(sheet, buildEnumColorRules(sheet, dataRange, 'ACTIVE_FLAG'));
}
