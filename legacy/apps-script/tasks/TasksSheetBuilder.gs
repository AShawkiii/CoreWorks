/**
 * TASKS — the main task database. Days Remaining / Days Overdue are live
 * ARRAYFORMULAs (architecture.md §6) built dynamically from column letters
 * resolved via col(), so a future schema reorder in Schemas.gs regenerates
 * correct formulas automatically. Created Date / Last Updated are written by
 * tasks/TaskService.gs, not typed by hand, so they're protected alongside
 * the two computed date-math columns.
 */
function buildTasksSheet() {
  var sheet = getOrCreateSheet('TASKS');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'TASKS');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('TASKS', 'Client ID', maxRows), 'CLIENTS', 'Client ID', false);
  applyCrossSheetValidation(sheet, rangeFor('TASKS', 'Client Name', maxRows), 'CLIENTS', 'Client Name', false);
  applyCrossSheetValidation(sheet, rangeFor('TASKS', 'Assigned To', maxRows), 'EMPLOYEES', 'Employee Name', true);
  applyCrossSheetValidation(sheet, rangeFor('TASKS', 'Reviewer', maxRows), 'EMPLOYEES', 'Employee Name', true);
  applyEnumValidation(sheet, rangeFor('TASKS', 'Frequency', maxRows), 'FREQUENCY', false);
  applyEnumValidation(sheet, rangeFor('TASKS', 'Priority', maxRows), 'PRIORITY', false);
  applyEnumValidation(sheet, rangeFor('TASKS', 'Status', maxRows), 'TASK_STATUS', false);
  applyEnumValidation(sheet, rangeFor('TASKS', 'Review Status', maxRows), 'REVIEW_STATUS', false);

  writeTasksDateFormulas(sheet, maxRows);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, rangeFor('TASKS', 'Status', maxRows), 'TASK_STATUS'))
    .concat(buildEnumColorRules(sheet, rangeFor('TASKS', 'Priority', maxRows), 'PRIORITY'))
    .concat([buildOverdueHighlightRule(sheet, rangeFor('TASKS', 'Days Overdue', maxRows), 0)])
  );

  var computedColumns = ['Days Remaining', 'Days Overdue', 'Created Date', 'Last Updated'];
  computedColumns.forEach(function (columnName) {
    protectRange(sheet, rangeFor('TASKS', columnName, maxRows), 'Tasks computed: ' + columnName);
  });
}

/** Writes the Days Remaining / Days Overdue ARRAYFORMULAs into row 2 of their columns (spills down to MAX_DATA_ROWS). */
function writeTasksDateFormulas(sheet, maxRows) {
  var idLetter = columnIndexToLetter(col('TASKS', 'Task ID'));
  var statusLetter = columnIndexToLetter(col('TASKS', 'Status'));
  var dueDateLetter = columnIndexToLetter(col('TASKS', 'Due Date'));
  var daysRemainingLetter = columnIndexToLetter(col('TASKS', 'Days Remaining'));
  var daysOverdueLetter = columnIndexToLetter(col('TASKS', 'Days Overdue'));
  var lastRow = maxRows + 1;

  var daysRemainingFormula = '=ARRAYFORMULA(IF($' + idLetter + '2:$' + idLetter + lastRow + '="","",' +
    'IF((' + statusLetter + '2:' + statusLetter + lastRow + '="Completed")+(' + statusLetter + '2:' + statusLetter + lastRow + '="Cancelled"),"",' +
    dueDateLetter + '2:' + dueDateLetter + lastRow + '-TODAY())))';

  var daysOverdueFormula = '=ARRAYFORMULA(IF($' + idLetter + '2:$' + idLetter + lastRow + '="","",' +
    'IF((' + dueDateLetter + '2:' + dueDateLetter + lastRow + '<>"")*(' + dueDateLetter + '2:' + dueDateLetter + lastRow + '<TODAY())*' +
    '(' + statusLetter + '2:' + statusLetter + lastRow + '<>"Completed")*(' + statusLetter + '2:' + statusLetter + lastRow + '<>"Cancelled"),' +
    'TODAY()-' + dueDateLetter + '2:' + dueDateLetter + lastRow + ',0)))';

  sheet.getRange(daysRemainingLetter + '2').setFormula(daysRemainingFormula);
  sheet.getRange(daysOverdueLetter + '2').setFormula(daysOverdueFormula);
}
