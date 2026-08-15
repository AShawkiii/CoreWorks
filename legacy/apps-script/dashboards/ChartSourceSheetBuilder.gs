/**
 * _CHART_SRC — a hidden sheet holding one live QUERY pivot per Control
 * Center chart (Phase 10's 6 charts). All 6 are single-sheet aggregates
 * (no cross-sheet join needed), so they're live formulas rather than
 * script-computed — always fresh, no trigger dependency (architecture.md
 * §6). Charts.gs (this stage) binds chart ranges to these blocks instead of
 * to raw CLIENTS/TASKS ranges, so chart definitions stay stable even as
 * those sheets grow.
 *
 * Layout: 6 blocks, each 2 columns wide with 1 blank spacer column between
 * them (columns A-B, D-E, G-H, J-K, M-N, P-Q). Row 1 = block title, row 2 =
 * the QUERY formula (spills downward).
 */
var CHART_SRC_LAYOUT = {
  TITLE_ROW: 1,
  QUERY_ROW: 2,
  BLOCK_COL_STRIDE: 3,
  DATA_ROWS: 60, // generous cap so Charts.gs's fixed-size chart ranges cover any QUERY spill (distinct statuses/employees/clients)
  BLOCKS: [
    { title: 'Client Progress' },
    { title: 'Tasks by Status' },
    { title: 'Tasks by Employee' },
    { title: 'Overdue Tasks by Client' },
    { title: 'Client Health Distribution' },
    { title: 'Employee Workload' }
  ]
};

function buildChartSourceSheet() {
  var sheet = getOrCreateSheet('CHART_SRC');
  CHART_SRC_LAYOUT.BLOCKS.forEach(function (block, i) {
    var startCol = 1 + i * CHART_SRC_LAYOUT.BLOCK_COL_STRIDE;
    sheet.getRange(CHART_SRC_LAYOUT.TITLE_ROW, startCol).setValue(block.title).setFontWeight('bold');
  });

  writeChartSourceFormulas(sheet);
  sheet.hideSheet();
}

function writeChartSourceFormulas(sheet) {
  var maxRow = CONST.MAX_DATA_ROWS + 1;
  var clientIdCol = columnIndexToLetter(col('CLIENTS', 'Client ID'));
  var clientNameCol = columnIndexToLetter(col('CLIENTS', 'Client Name'));
  var weightedPctCol = columnIndexToLetter(col('CLIENTS', 'Weighted Completion %'));
  var healthCol = columnIndexToLetter(col('CLIENTS', 'Client Health'));

  var taskIdCol = columnIndexToLetter(col('TASKS', 'Task ID'));
  var taskClientNameCol = columnIndexToLetter(col('TASKS', 'Client Name'));
  var taskStatusCol = columnIndexToLetter(col('TASKS', 'Status'));
  var taskAssignedToCol = columnIndexToLetter(col('TASKS', 'Assigned To'));
  var taskDaysOverdueCol = columnIndexToLetter(col('TASKS', 'Days Overdue'));

  var queries = [
    '=QUERY(CLIENTS!A2:' + columnIndexToLetter(headerRow('CLIENTS').length) + maxRow + ',' +
      '"select ' + clientNameCol + ', ' + weightedPctCol + ' where ' + clientIdCol + ' is not null ' +
      'order by ' + clientNameCol + ' label ' + weightedPctCol + ' \'Weighted Completion %\'",0)',

    '=QUERY(TASKS!A2:' + columnIndexToLetter(headerRow('TASKS').length) + maxRow + ',' +
      '"select ' + taskStatusCol + ', count(' + taskIdCol + ') where ' + taskIdCol + ' is not null ' +
      'group by ' + taskStatusCol + ' label count(' + taskIdCol + ') \'Count\', ' + taskStatusCol + ' \'Status\'",0)',

    '=QUERY(TASKS!A2:' + columnIndexToLetter(headerRow('TASKS').length) + maxRow + ',' +
      '"select ' + taskAssignedToCol + ', count(' + taskIdCol + ') where ' + taskIdCol + ' is not null ' +
      'group by ' + taskAssignedToCol + ' label count(' + taskIdCol + ') \'Count\', ' + taskAssignedToCol + ' \'Employee\'",0)',

    '=QUERY(TASKS!A2:' + columnIndexToLetter(headerRow('TASKS').length) + maxRow + ',' +
      '"select ' + taskClientNameCol + ', count(' + taskIdCol + ') where ' + taskDaysOverdueCol + ' > 0 ' +
      'group by ' + taskClientNameCol + ' label count(' + taskIdCol + ') \'Overdue Count\', ' + taskClientNameCol + ' \'Client\'",0)',

    '=QUERY(CLIENTS!A2:' + columnIndexToLetter(headerRow('CLIENTS').length) + maxRow + ',' +
      '"select ' + healthCol + ', count(' + clientIdCol + ') where ' + clientIdCol + ' is not null ' +
      'group by ' + healthCol + ' label count(' + clientIdCol + ') \'Count\', ' + healthCol + ' \'Health\'",0)',

    '=QUERY(TASKS!A2:' + columnIndexToLetter(headerRow('TASKS').length) + maxRow + ',' +
      '"select ' + taskAssignedToCol + ', count(' + taskIdCol + ') where ' + taskIdCol + ' is not null ' +
      'and ' + taskStatusCol + ' <> \'Completed\' and ' + taskStatusCol + ' <> \'Cancelled\' ' +
      'group by ' + taskAssignedToCol + ' label count(' + taskIdCol + ') \'Open Tasks\', ' + taskAssignedToCol + ' \'Employee\'",0)'
  ];

  queries.forEach(function (formula, i) {
    var startCol = 1 + i * CHART_SRC_LAYOUT.BLOCK_COL_STRIDE;
    sheet.getRange(CHART_SRC_LAYOUT.QUERY_ROW, startCol).setFormula(formula);
  });
}
