/**
 * CLIENT_REQUESTS — outstanding items awaited from clients. Days Waiting and
 * Days Waiting Bucket are live ARRAYFORMULAs mirroring
 * utils/DateLogic.gs::computeDaysWaiting / bucketDaysWaiting exactly. Days
 * Waiting Bucket is the confirmed schema addition (architecture.md §9).
 */
function buildClientRequestsSheet() {
  var sheet = getOrCreateSheet('CLIENT_REQUESTS');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'CLIENT_REQUESTS');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('CLIENT_REQUESTS', 'Client ID', maxRows), 'CLIENTS', 'Client ID', false);
  applyCrossSheetValidation(sheet, rangeFor('CLIENT_REQUESTS', 'Client', maxRows), 'CLIENTS', 'Client Name', false);
  applyCrossSheetValidation(sheet, rangeFor('CLIENT_REQUESTS', 'Assigned To', maxRows), 'EMPLOYEES', 'Employee Name', true);
  applyEnumValidation(sheet, rangeFor('CLIENT_REQUESTS', 'Status', maxRows), 'REQUEST_STATUS', false);
  applyEnumValidation(sheet, rangeFor('CLIENT_REQUESTS', 'Priority', maxRows), 'PRIORITY', false);

  writeClientRequestsFormulas(sheet, maxRows);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, rangeFor('CLIENT_REQUESTS', 'Status', maxRows), 'REQUEST_STATUS'))
    .concat(buildStaleRequestRules(sheet, rangeFor('CLIENT_REQUESTS', 'Days Waiting Bucket', maxRows)))
  );

  var computedColumns = ['Days Waiting', 'Days Waiting Bucket'];
  computedColumns.forEach(function (columnName) {
    protectRange(sheet, rangeFor('CLIENT_REQUESTS', columnName, maxRows), 'Client requests computed: ' + columnName);
  });
}

function writeClientRequestsFormulas(sheet, maxRows) {
  var idLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Request ID'));
  var statusLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Status'));
  var requestedDateLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Requested Date'));
  var receivedDateLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Received Date'));
  var daysWaitingLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Days Waiting'));
  var bucketLetter = columnIndexToLetter(col('CLIENT_REQUESTS', 'Days Waiting Bucket'));
  var lastRow = maxRows + 1;

  var daysWaitingFormula = '=ARRAYFORMULA(IF($' + idLetter + '2:$' + idLetter + lastRow + '="","",' +
    'IF((' + statusLetter + '2:' + statusLetter + lastRow + '="Received")+(' + statusLetter + '2:' + statusLetter + lastRow + '="Not Available")+(' + statusLetter + '2:' + statusLetter + lastRow + '="Cancelled"),' +
    'IF(' + receivedDateLetter + '2:' + receivedDateLetter + lastRow + '<>"",' + receivedDateLetter + '2:' + receivedDateLetter + lastRow + '-' + requestedDateLetter + '2:' + requestedDateLetter + lastRow + ',""),' +
    'TODAY()-' + requestedDateLetter + '2:' + requestedDateLetter + lastRow + ')))';

  var bucketFormula = '=ARRAYFORMULA(IF($' + idLetter + '2:$' + idLetter + lastRow + '="","",' +
    'IF(' + daysWaitingLetter + '2:' + daysWaitingLetter + lastRow + '="","",' +
    'IF(' + daysWaitingLetter + '2:' + daysWaitingLetter + lastRow + '<=3,"0-3",' +
    'IF(' + daysWaitingLetter + '2:' + daysWaitingLetter + lastRow + '<=7,"4-7",' +
    'IF(' + daysWaitingLetter + '2:' + daysWaitingLetter + lastRow + '<=14,"8-14","15+"))))))';

  sheet.getRange(daysWaitingLetter + '2').setFormula(daysWaitingFormula);
  sheet.getRange(bucketLetter + '2').setFormula(bucketFormula);
}
