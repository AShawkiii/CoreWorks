/**
 * IO layer for CONTROL_CENTER's Client Health Table and Issues table
 * (Phase 10). Both need a per-row cross-sheet join (client -> its tasks;
 * surfaced issues -> their clients), which is far more robust and testable
 * done in script than as a single spilling QUERY/array formula — consistent
 * with architecture.md §6/§0-C ("cross-sheet aggregates with evolving
 * business rules are script-computed, not live formulas"). The 9 KPI cards
 * stay as live formulas (DashboardQueryUtils.gs) since those are simple
 * single-sheet aggregates that don't need this.
 *
 * Called by the daily recalculation trigger, the "Rebuild Dashboards" menu
 * item (both Stage 7), and once at the end of setupSpreadsheet() so the
 * Control Center isn't empty the first time it's opened.
 */
function renderControlCenter() {
  var sheet = getSheet('CONTROL_CENTER');
  buildControlCenterKpiFormulas();

  var healthRows = buildClientHealthTableRows();
  var issueRows = buildIssuesTableRows();

  writeReportTableRows(sheet, CC_LAYOUT.HEALTH_TABLE_START_ROW, CC_LAYOUT.HEALTH_TABLE_HEADERS.length, CC_LAYOUT.HEALTH_TABLE_MAX_ROWS, healthRows);
  writeReportTableRows(sheet, CC_LAYOUT.ISSUES_HEADER_ROW + 1, CC_LAYOUT.ISSUES_HEADERS.length, CC_LAYOUT.ISSUES_MAX_ROWS, issueRows);

  var healthColumnA1 = columnIndexToLetter(CC_LAYOUT.HEALTH_TABLE_HEADERS.length) + CC_LAYOUT.HEALTH_TABLE_START_ROW +
    ':' + columnIndexToLetter(CC_LAYOUT.HEALTH_TABLE_HEADERS.length) + (CC_LAYOUT.HEALTH_TABLE_START_ROW + CC_LAYOUT.HEALTH_TABLE_MAX_ROWS - 1);
  var severityColumnA1 = 'C' + (CC_LAYOUT.ISSUES_HEADER_ROW + 1) +
    ':C' + (CC_LAYOUT.ISSUES_HEADER_ROW + CC_LAYOUT.ISSUES_MAX_ROWS);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, healthColumnA1, 'CLIENT_HEALTH'))
    .concat(buildEnumColorRules(sheet, severityColumnA1, 'ISSUE_SEVERITY')));
}

function buildClientHealthTableRows() {
  var clients = getAllRows('CLIENTS');
  var tasks = getAllRows('TASKS');
  var today = new Date();

  var tasksByClient = {};
  tasks.forEach(function (t) {
    if (!tasksByClient[t['Client ID']]) tasksByClient[t['Client ID']] = [];
    tasksByClient[t['Client ID']].push(t);
  });

  return clients.map(function (c) {
    var clientTasks = tasksByClient[c['Client ID']] || [];
    var openTasks = clientTasks.filter(function (t) { return isTaskOpen(t['Status']); }).length;
    var overdue = clientTasks.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length;
    var waitingClient = clientTasks.filter(function (t) { return t['Status'] === 'Waiting Client'; }).length;

    return [c['Client Name'], c['Account Manager'], c['Weighted Completion %'], openTasks, overdue, waitingClient, c['Next Deadline'], c['Client Health']];
  });
}

function buildIssuesTableRows() {
  return getSurfacedIssuesForControlCenter().map(function (i) {
    return [i['Client'], i['Issue'], i['Severity'], i['Status'], i['Deadline']];
  });
}
