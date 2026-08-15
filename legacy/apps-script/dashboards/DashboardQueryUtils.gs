/**
 * Shared formula-string builders for the simple, always-fresh KPI-card
 * formulas (Control Center, Client Dashboard, Monthly Close Dashboard).
 * Anything requiring a per-row cross-sheet join (e.g. "overdue tasks FOR
 * THIS client") is script-computed instead — see the note in
 * dashboards/ControlCenterEngine.gs.
 */

function countifFormula(sheetKey, columnName, criteria) {
  var sheetName = SHEETS[sheetKey];
  var range = rangeFor(sheetKey, columnName, CONST.MAX_DATA_ROWS);
  return '=COUNTIF(' + sheetName + '!' + range + ',' + quoteCriteria(criteria) + ')';
}

function countifsFormula(sheetKey, criteriaPairs) {
  var sheetName = SHEETS[sheetKey];
  var parts = criteriaPairs.map(function (pair) {
    return sheetName + '!' + rangeFor(sheetKey, pair.column, CONST.MAX_DATA_ROWS) + ',' + quoteCriteria(pair.criteria);
  });
  return '=COUNTIFS(' + parts.join(',') + ')';
}

function averageFormula(sheetKey, columnName) {
  var sheetName = SHEETS[sheetKey];
  var range = rangeFor(sheetKey, columnName, CONST.MAX_DATA_ROWS);
  return '=IFERROR(AVERAGE(' + sheetName + '!' + range + '),0)';
}

function quoteCriteria(criteria) {
  return '"' + String(criteria).replace(/"/g, '""') + '"';
}
