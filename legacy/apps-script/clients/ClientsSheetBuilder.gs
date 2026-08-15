/**
 * CLIENTS — master client database. Columns match the spec exactly except
 * the confirmed deviation (architecture.md §9): "Overall Progress" is split
 * into "Simple Completion %" and "Weighted Completion %".
 *
 * Script-computed columns (Client Health, both completion %, Last Activity,
 * Next Deadline) are protected — they're written by HealthEngine/
 * ProgressEngine (Stage 4/5), not edited by hand. Contract Status is the
 * manual lever for "On Hold" (see HealthLogic's override rule).
 */
function buildClientsSheet() {
  var sheet = getOrCreateSheet('CLIENTS');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'CLIENTS');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('CLIENTS', 'Service Package', maxRows), 'SERVICE_PACKAGES', 'Package Name', false);
  applyCrossSheetValidation(sheet, rangeFor('CLIENTS', 'Account Manager', maxRows), 'EMPLOYEES', 'Employee Name', false);
  applyCrossSheetValidation(sheet, rangeFor('CLIENTS', 'Backup Team Member', maxRows), 'EMPLOYEES', 'Employee Name', true);
  applyEnumValidation(sheet, rangeFor('CLIENTS', 'Reporting Frequency', maxRows), 'REPORTING_FREQUENCY', false);
  applyEnumValidation(sheet, rangeFor('CLIENTS', 'Contract Status', maxRows), 'CONTRACT_STATUS', false);
  applyEnumValidation(sheet, rangeFor('CLIENTS', 'Priority', maxRows), 'PRIORITY', false);
  applyEnumValidation(sheet, rangeFor('CLIENTS', 'Client Health', maxRows), 'CLIENT_HEALTH', false);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, rangeFor('CLIENTS', 'Client Health', maxRows), 'CLIENT_HEALTH'))
    .concat(buildEnumColorRules(sheet, rangeFor('CLIENTS', 'Priority', maxRows), 'PRIORITY'))
    .concat(buildEnumColorRules(sheet, rangeFor('CLIENTS', 'Contract Status', maxRows), 'CONTRACT_STATUS'))
  );

  var computedColumns = ['Client Health', 'Simple Completion %', 'Weighted Completion %', 'Last Activity', 'Next Deadline'];
  computedColumns.forEach(function (columnName) {
    protectRange(sheet, rangeFor('CLIENTS', columnName, maxRows), 'Clients computed: ' + columnName);
  });
}
