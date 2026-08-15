/**
 * IO layer for MONTHLY_CLOSE_DASHBOARD (Phase 13). Filtered by the Client
 * and Month cells in MCD_LAYOUT. Summary counts are over every TASKS row
 * for that client + period (the whole month's workload, not just tasks
 * tagged Service Area = "Month-End Closing") since "the close" spans every
 * deliverable due that period; the stage-by-stage visual pulls from the
 * matching MONTHLY_CLOSE row (built from its Close ID = client + period).
 */
function renderMonthlyCloseDashboard(clientName, month) {
  var sheet = getSheet('MONTHLY_CLOSE_DASHBOARD');
  var selectedClient = clientName || sheet.getRange(MCD_LAYOUT.CLIENT_FILTER_VALUE_CELL).getValue();
  var selectedMonth = month || sheet.getRange(MCD_LAYOUT.MONTH_FILTER_VALUE_CELL).getValue();

  var client = selectedClient ? getAllRows('CLIENTS').filter(function (c) { return c['Client Name'] === selectedClient; })[0] : null;
  if (!client || !selectedMonth) {
    clearMonthlyCloseDashboard(sheet);
    return;
  }

  var today = new Date();
  var periodTasks = getAllRows('TASKS').filter(function (t) { return t['Client ID'] === client['Client ID'] && t['Period'] === selectedMonth; });
  var counted = periodTasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });

  var completed = counted.filter(function (t) { return t['Status'] === 'Completed'; }).length;
  var blocked = counted.filter(function (t) { return t['Status'] === 'Blocked'; }).length;
  var waitingClient = counted.filter(function (t) { return t['Status'] === 'Waiting Client'; }).length;
  var overdue = counted.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length;
  var pending = counted.filter(function (t) {
    return isTaskOpen(t['Status']) && t['Status'] !== 'Blocked' && t['Status'] !== 'Waiting Client';
  }).length;
  var pct = computeSimpleCompletion(counted).pct;

  var summaryValues = { 'Completion %': pct, 'Completed': completed, 'Pending': pending, 'Overdue': overdue, 'Waiting Client': waitingClient, 'Blocked': blocked };
  MCD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    var colIndex = MCD_LAYOUT.SUMMARY_START_COL + i * MCD_LAYOUT.SUMMARY_COL_STRIDE;
    sheet.getRange(MCD_LAYOUT.SUMMARY_VALUE_ROW, colIndex).setValue(summaryValues[label]);
  });

  var closeId = buildMonthlyCloseId(client['Client ID'], selectedMonth);
  var closeRow = getAllRows('MONTHLY_CLOSE').filter(function (r) { return r['Close ID'] === closeId; })[0];
  var stageValues = MONTHLY_CLOSE_STAGE_COLUMNS.map(function (stageName) { return closeRow ? closeRow[stageName] : ''; });
  sheet.getRange(MCD_LAYOUT.STAGES_VALUE_ROW, 1, 1, stageValues.length).setValues([stageValues]);
}

function clearMonthlyCloseDashboard(sheet) {
  MCD_LAYOUT.SUMMARY_CARDS.forEach(function (label, i) {
    sheet.getRange(MCD_LAYOUT.SUMMARY_VALUE_ROW, MCD_LAYOUT.SUMMARY_START_COL + i * MCD_LAYOUT.SUMMARY_COL_STRIDE).clearContent();
  });
  sheet.getRange(MCD_LAYOUT.STAGES_VALUE_ROW, 1, 1, MONTHLY_CLOSE_STAGE_COLUMNS.length).clearContent();
}
