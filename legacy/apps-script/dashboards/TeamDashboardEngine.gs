/**
 * IO layer for TEAM_DASHBOARD (Phase 12) — one row per employee.
 */
function renderTeamDashboard() {
  var sheet = getSheet('TEAM_DASHBOARD');
  var employees = getAllRows('EMPLOYEES');
  var tasks = getAllRows('TASKS');
  var today = new Date();
  var margin = Number(getSetting('WORKLOAD', 'WORKLOAD_OVERLOAD_MARGIN', CONST.WORKLOAD_OVERLOAD_MARGIN));

  var rows = employees.map(function (e) {
    var empTasks = tasks.filter(function (t) { return t['Assigned To'] === e['Employee Name']; });
    var counted = empTasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });
    var openTasks = counted.filter(function (t) { return isTaskOpen(t['Status']); });

    var assigned = counted.length;
    var completed = counted.filter(function (t) { return t['Status'] === 'Completed'; }).length;
    var inProgress = counted.filter(function (t) { return t['Status'] === 'In Progress'; }).length;
    var overdue = counted.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length;
    var waitingClient = counted.filter(function (t) { return t['Status'] === 'Waiting Client'; }).length;
    var critical = openTasks.filter(function (t) { return t['Priority'] === 'Critical'; }).length;
    var pct = computeSimpleCompletion(counted).pct;
    var overloaded = isOverloaded(openTasks.length, e['Capacity'], margin);

    return [e['Employee Name'], e['Role'], assigned, completed, inProgress, overdue, waitingClient, critical, pct, e['Capacity'], overloaded ? 'Overloaded' : 'OK'];
  });

  writeReportTableRows(sheet, TD_LAYOUT.START_ROW, TD_LAYOUT.HEADERS.length, TD_LAYOUT.MAX_ROWS, rows);
}
