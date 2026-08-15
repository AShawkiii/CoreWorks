/**
 * IO layer for CLIENT_DASHBOARD (Phase 11). Renders the full single-client
 * view for whatever name is in the picker cell (CD_LAYOUT.SELECTOR_VALUE_CELL).
 * Called by the onEdit trigger when that cell changes (automation/
 * Triggers.gs, Stage 7) and by the "Rebuild Dashboards" menu action.
 */
function renderClientDashboard(clientName) {
  var sheet = getSheet('CLIENT_DASHBOARD');
  var selectedName = clientName || sheet.getRange(CD_LAYOUT.SELECTOR_VALUE_CELL).getValue();
  var client = getAllRows('CLIENTS').filter(function (c) { return c['Client Name'] === selectedName; })[0];

  if (!client) {
    clearClientDashboardSections(sheet);
    return;
  }

  var tasks = getTasksForClient(client['Client ID']);
  var today = new Date();

  writeClientInfoBlock(sheet, client);
  writeTaskSummaryCards(sheet, tasks);
  writeServiceProgressTable(sheet, tasks);
  writeCurrentTasksTable(sheet, tasks, today);
  writeClientRequestsTable(sheet, client);
  writeIssuesTable(sheet, client);
  writeUpcomingDeadlinesTable(sheet, tasks, today);
}

function clearClientDashboardSections(sheet) {
  CD_LAYOUT.INFO_FIELDS.forEach(function (label, i) { sheet.getRange(CD_LAYOUT.INFO_START_ROW + i, 2).clearContent(); });
  CD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    sheet.getRange(CD_LAYOUT.SUMMARY_VALUE_ROW, CD_LAYOUT.SUMMARY_START_COL + i * CD_LAYOUT.SUMMARY_COL_STRIDE).clearContent();
  });
  writeReportTableRows(sheet, CD_LAYOUT.SERVICE_PROGRESS_HEADER_ROW + 1, CD_LAYOUT.SERVICE_PROGRESS_HEADERS.length, CD_LAYOUT.SERVICE_PROGRESS_MAX_ROWS, []);
  writeReportTableRows(sheet, CD_LAYOUT.CURRENT_TASKS_HEADER_ROW + 1, CD_LAYOUT.CURRENT_TASKS_HEADERS.length, CD_LAYOUT.CURRENT_TASKS_MAX_ROWS, []);
  writeReportTableRows(sheet, CD_LAYOUT.REQUESTS_HEADER_ROW + 1, CD_LAYOUT.REQUESTS_HEADERS.length, CD_LAYOUT.REQUESTS_MAX_ROWS, []);
  writeReportTableRows(sheet, CD_LAYOUT.ISSUES_HEADER_ROW + 1, CD_LAYOUT.ISSUES_HEADERS.length, CD_LAYOUT.ISSUES_MAX_ROWS, []);
  writeReportTableRows(sheet, CD_LAYOUT.DEADLINES_HEADER_ROW + 1, CD_LAYOUT.DEADLINES_HEADERS.length, CD_LAYOUT.DEADLINES_MAX_ROWS, []);
}

function writeClientInfoBlock(sheet, client) {
  CD_LAYOUT.INFO_FIELDS.forEach(function (label, i) {
    var value = label === 'Client' ? client['Client Name'] : client[label];
    sheet.getRange(CD_LAYOUT.INFO_START_ROW + i, 2).setValue(value);
  });
}

function writeTaskSummaryCards(sheet, tasks) {
  var counted = tasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });
  var today = new Date();
  var counts = {
    'Total': counted.length,
    'Completed': counted.filter(function (t) { return t['Status'] === 'Completed'; }).length,
    'In Progress': counted.filter(function (t) { return t['Status'] === 'In Progress'; }).length,
    'Not Started': counted.filter(function (t) { return t['Status'] === 'Not Started'; }).length,
    'Waiting Client': counted.filter(function (t) { return t['Status'] === 'Waiting Client'; }).length,
    'Blocked': counted.filter(function (t) { return t['Status'] === 'Blocked'; }).length,
    'Overdue': counted.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length
  };

  CD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    var colIndex = CD_LAYOUT.SUMMARY_START_COL + i * CD_LAYOUT.SUMMARY_COL_STRIDE;
    sheet.getRange(CD_LAYOUT.SUMMARY_VALUE_ROW, colIndex).setValue(counts[label]);
  });
}

function writeServiceProgressTable(sheet, tasks) {
  var byArea = {};
  tasks.filter(function (t) { return t['Status'] !== 'Cancelled'; }).forEach(function (t) {
    var area = t['Service Area'] || 'Unspecified';
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(t);
  });

  var rows = Object.keys(byArea).sort().map(function (area) {
    var pct = computeSimpleCompletion(byArea[area]).pct;
    return [area, pct];
  });

  writeReportTableRows(sheet, CD_LAYOUT.SERVICE_PROGRESS_HEADER_ROW + 1, CD_LAYOUT.SERVICE_PROGRESS_HEADERS.length, CD_LAYOUT.SERVICE_PROGRESS_MAX_ROWS, rows);
}

function writeCurrentTasksTable(sheet, tasks, today) {
  var openTasks = tasks.filter(function (t) { return isTaskOpen(t['Status']); });
  openTasks.sort(function (a, b) { return new Date(a['Due Date'] || 0) - new Date(b['Due Date'] || 0); });

  var rows = openTasks.map(function (t) {
    return [t['Task Name'], t['Assigned To'], t['Status'], t['Priority'], t['Due Date'], computeDaysRemaining(t['Due Date'], t['Status'], today)];
  });

  writeReportTableRows(sheet, CD_LAYOUT.CURRENT_TASKS_HEADER_ROW + 1, CD_LAYOUT.CURRENT_TASKS_HEADERS.length, CD_LAYOUT.CURRENT_TASKS_MAX_ROWS, rows);
}

function writeClientRequestsTable(sheet, client) {
  var requests = getAllRows('CLIENT_REQUESTS').filter(function (r) { return r['Client ID'] === client['Client ID'] && isRequestOpen(r['Status']); });
  var rows = requests.map(function (r) { return [r['Request'], r['Status'], r['Days Waiting']]; });
  writeReportTableRows(sheet, CD_LAYOUT.REQUESTS_HEADER_ROW + 1, CD_LAYOUT.REQUESTS_HEADERS.length, CD_LAYOUT.REQUESTS_MAX_ROWS, rows);
}

function writeIssuesTable(sheet, client) {
  var issues = getAllRows('ISSUES').filter(function (i) { return i['Client ID'] === client['Client ID'] && isIssueOpen(i['Status']); });
  var rows = issues.map(function (i) { return [i['Issue'], i['Severity'], i['Status']]; });
  writeReportTableRows(sheet, CD_LAYOUT.ISSUES_HEADER_ROW + 1, CD_LAYOUT.ISSUES_HEADERS.length, CD_LAYOUT.ISSUES_MAX_ROWS, rows);
}

function writeUpcomingDeadlinesTable(sheet, tasks, today) {
  var withDeadlines = tasks.filter(function (t) { return isTaskOpen(t['Status']) && t['Due Date']; });
  withDeadlines.sort(function (a, b) { return new Date(a['Due Date']) - new Date(b['Due Date']); });

  var rows = withDeadlines.slice(0, CD_LAYOUT.DEADLINES_MAX_ROWS).map(function (t) {
    return [t['Task Name'], t['Due Date'], computeDaysRemaining(t['Due Date'], t['Status'], today)];
  });

  writeReportTableRows(sheet, CD_LAYOUT.DEADLINES_HEADER_ROW + 1, CD_LAYOUT.DEADLINES_HEADERS.length, CD_LAYOUT.DEADLINES_MAX_ROWS, rows);
}
