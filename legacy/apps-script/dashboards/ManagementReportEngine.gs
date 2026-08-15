/**
 * IO layer for the monthly management report (Phase 17). Rewrites a single
 * MANAGEMENT_REPORT sheet each run (rather than one sheet per month) — the
 * report is a point-in-time snapshot for the current meeting, not a
 * historical archive; ACTIVITY_LOG is the system's audit trail. Bound to a
 * monthly time-driven trigger (automation/Triggers.gs) and the "Run:
 * Generate Management Report" menu action.
 */
function generateMonthlyManagementReport() {
  var sheet = getOrCreateSheet('MANAGEMENT_REPORT');
  var today = new Date();

  var report = buildManagementReport(
    getAllRows('CLIENTS'),
    getAllRows('TASKS'),
    getAllRows('ISSUES'),
    getAllRows('CLIENT_REQUESTS'),
    getAllRows('EMPLOYEES'),
    today
  );

  renderManagementReport(sheet, report, today);
  logActivity('Management Report Generated', 'System', formatPeriod(today), '', '', '');

  return report;
}

function renderManagementReport(sheet, report, today) {
  sheet.getRange(1, 1).setValue('FINANCE LAB — MANAGEMENT REPORT').setFontSize(18).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('Generated: ' + today).setFontStyle('italic').setFontColor('#555555');

  var row = 4;
  row = renderListSection(sheet, row, 'Best Performing Clients', report.clientPerformance.best);
  row = renderListSection(sheet, row, 'At-Risk Clients', report.clientPerformance.atRisk);
  row = renderListSection(sheet, row, 'Delayed Clients', report.clientPerformance.delayed);
  row = renderListSection(sheet, row, 'On-Hold Clients', report.clientPerformance.onHold);

  row = renderTeamPerformanceSection(sheet, row, report.teamPerformance);
  row = renderOperationalRisksSection(sheet, row, report.operationalRisks);
  row = renderManagementAttentionSection(sheet, row, report.managementAttention);
}

function renderListSection(sheet, row, title, items) {
  writeSectionHeader(sheet, row, title + ' (' + items.length + ')');
  row++;
  if (!items.length) {
    sheet.getRange(row, 1).setValue('None').setFontStyle('italic');
    row++;
  } else {
    items.forEach(function (item) {
      sheet.getRange(row, 1).setValue(item);
      row++;
    });
  }
  return row + 1;
}

function renderTeamPerformanceSection(sheet, row, teamPerformance) {
  writeSectionHeader(sheet, row, 'Team Performance');
  row++;
  writeTableHeaders(sheet, row, ['Employee', 'Tasks', 'Completed', 'Overdue', 'Completion %']);
  row++;
  teamPerformance.forEach(function (t) {
    sheet.getRange(row, 1, 1, 5).setValues([[t.employee, t.tasks, t.completed, t.overdue, t.completionPct]]);
    row++;
  });
  return row + 1;
}

function renderOperationalRisksSection(sheet, row, risks) {
  writeSectionHeader(sheet, row, 'Operational Risks');
  row++;
  var pairs = [
    ['Overdue Tasks', risks.overdueTasks],
    ['Critical Issues', risks.criticalIssues],
    ['Blocked Tasks', risks.blockedTasks],
    ['Outstanding Client Requests', risks.outstandingRequests]
  ];
  pairs.forEach(function (pair) {
    sheet.getRange(row, 1).setValue(pair[0]);
    sheet.getRange(row, 2).setValue(pair[1]);
    row++;
  });
  return row + 1;
}

function renderManagementAttentionSection(sheet, row, attentionItems) {
  writeSectionHeader(sheet, row, 'Management Attention');
  row++;
  writeTableHeaders(sheet, row, ['Type', 'Item']);
  row++;
  if (!attentionItems.length) {
    sheet.getRange(row, 1).setValue('Nothing requires immediate attention.').setFontStyle('italic');
    row++;
  } else {
    attentionItems.forEach(function (item) {
      sheet.getRange(row, 1, 1, 2).setValues([[item.type, item.label]]);
      row++;
    });
  }
  return row + 1;
}
