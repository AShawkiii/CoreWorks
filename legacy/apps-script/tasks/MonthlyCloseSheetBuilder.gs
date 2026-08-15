/**
 * MONTHLY_CLOSE — one row per client per month, tracking the 18 closing
 * stages (Sales .. Final Approval, see SCHEMAS.MONTHLY_CLOSE /
 * MONTHLY_CLOSE_STAGE_COLUMNS in Schemas.gs). Completion % and Close Status
 * are live formulas derived from the stage columns; stage columns themselves
 * are manually maintained by staff via dropdown as they work the close
 * checklist, so they are NOT protected.
 */
function buildMonthlyCloseSheet() {
  var sheet = getOrCreateSheet('MONTHLY_CLOSE');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'MONTHLY_CLOSE');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('MONTHLY_CLOSE', 'Client', maxRows), 'CLIENTS', 'Client Name', false);

  var stageRange = stageColumnsRangeFor('MONTHLY_CLOSE', maxRows);
  applyEnumValidation(sheet, stageRange, 'CLOSE_STAGE_STATUS', false);
  applyEnumValidation(sheet, rangeFor('MONTHLY_CLOSE', 'Close Status', maxRows), 'CLOSE_STATUS', false);

  writeMonthlyCloseFormulas(sheet, maxRows);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, stageRange, 'CLOSE_STAGE_STATUS'))
  );

  var computedColumns = ['Close Status', 'Completion %'];
  computedColumns.forEach(function (columnName) {
    protectRange(sheet, rangeFor('MONTHLY_CLOSE', columnName, maxRows), 'Monthly close computed: ' + columnName);
  });
}

/** Builds the combined A1 range covering all 18 contiguous stage columns (Sales..Final Approval). */
function stageColumnsRangeFor(sheetKey, maxRows) {
  var firstCol = col(sheetKey, MONTHLY_CLOSE_STAGE_COLUMNS[0]);
  var lastCol = col(sheetKey, MONTHLY_CLOSE_STAGE_COLUMNS[MONTHLY_CLOSE_STAGE_COLUMNS.length - 1]);
  return columnIndexToLetter(firstCol) + '2:' + columnIndexToLetter(lastCol) + (maxRows + 1);
}

function writeMonthlyCloseFormulas(sheet, maxRows) {
  var completionCol = col('MONTHLY_CLOSE', 'Completion %');
  var closeStatusCol = col('MONTHLY_CLOSE', 'Close Status');
  var firstStageCol = col('MONTHLY_CLOSE', MONTHLY_CLOSE_STAGE_COLUMNS[0]);
  var lastStageCol = col('MONTHLY_CLOSE', MONTHLY_CLOSE_STAGE_COLUMNS[MONTHLY_CLOSE_STAGE_COLUMNS.length - 1]);
  var lastRow = maxRows + 1;

  var stageStartOffsetFromCompletion = firstStageCol - completionCol;
  var stageEndOffsetFromCompletion = lastStageCol - completionCol;
  var stageRangeR1C1FromCompletion = 'RC[' + stageStartOffsetFromCompletion + ']:RC[' + stageEndOffsetFromCompletion + ']';

  var completionFormula = '=IF(COUNTA(' + stageRangeR1C1FromCompletion + ')=0,0,' +
    'COUNTIF(' + stageRangeR1C1FromCompletion + ',"Completed")/COUNTA(' + stageRangeR1C1FromCompletion + '))';
  sheet.getRange(2, completionCol, maxRows, 1).setFormulaR1C1(completionFormula);

  var stageStartOffsetFromStatus = firstStageCol - closeStatusCol;
  var stageEndOffsetFromStatus = lastStageCol - closeStatusCol;
  var stageRangeR1C1FromStatus = 'RC[' + stageStartOffsetFromStatus + ']:RC[' + stageEndOffsetFromStatus + ']';
  var completionOffsetFromStatus = completionCol - closeStatusCol;
  var completionR1C1FromStatus = 'RC[' + completionOffsetFromStatus + ']';

  var closeStatusFormula = '=IFS(' +
    completionR1C1FromStatus + '=1,"Closed",' +
    'COUNTIF(' + stageRangeR1C1FromStatus + ',"Blocked")>0,"Blocked",' +
    completionR1C1FromStatus + '>0,"In Progress",' +
    'TRUE,"Not Started")';
  sheet.getRange(2, closeStatusCol, maxRows, 1).setFormulaR1C1(closeStatusFormula);

  sheet.getRange(2, completionCol, maxRows, 1).setNumberFormat('0%');
}
