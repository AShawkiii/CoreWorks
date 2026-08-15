/**
 * Pure monthly management report assembly — no Apps Script globals,
 * Node-testable. Takes plain row arrays (as returned by getAllRows) plus an
 * explicit `today`, and returns a structured report object; the IO layer
 * (ManagementReportEngine.gs) just renders it into a sheet.
 */
function buildManagementReport(clients, tasks, issues, requests, employees, today) {
  return {
    clientPerformance: buildClientPerformanceSection(clients),
    teamPerformance: buildTeamPerformanceSection(tasks, employees, today),
    operationalRisks: buildOperationalRisksSection(tasks, issues, requests, today),
    managementAttention: buildManagementAttentionSection(clients, issues, tasks, requests)
  };
}

function buildClientPerformanceSection(clients) {
  var byHealth = { 'On Track': [], 'At Risk': [], 'Delayed': [], 'On Hold': [] };
  clients.forEach(function (c) {
    if (byHealth[c['Client Health']]) byHealth[c['Client Health']].push(c);
  });

  var byProgressDesc = function (a, b) { return (b['Weighted Completion %'] || 0) - (a['Weighted Completion %'] || 0); };

  return {
    best: byHealth['On Track'].slice().sort(byProgressDesc).map(function (c) { return c['Client Name']; }),
    atRisk: byHealth['At Risk'].map(function (c) { return c['Client Name']; }),
    delayed: byHealth['Delayed'].map(function (c) { return c['Client Name']; }),
    onHold: byHealth['On Hold'].map(function (c) { return c['Client Name']; })
  };
}

function buildTeamPerformanceSection(tasks, employees, today) {
  return employees.map(function (e) {
    var empTasks = tasks.filter(function (t) { return t['Assigned To'] === e['Employee Name'] && t['Status'] !== 'Cancelled'; });
    var completion = computeSimpleCompletion(empTasks);
    var overdue = empTasks.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length;
    return {
      employee: e['Employee Name'],
      tasks: completion.total,
      completed: completion.completed,
      overdue: overdue,
      completionPct: completion.pct
    };
  });
}

function buildOperationalRisksSection(tasks, issues, requests, today) {
  return {
    overdueTasks: tasks.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length,
    criticalIssues: issues.filter(function (i) { return isIssueOpen(i['Status']) && i['Severity'] === 'Critical'; }).length,
    blockedTasks: tasks.filter(function (t) { return t['Status'] === 'Blocked'; }).length,
    outstandingRequests: requests.filter(function (r) { return isRequestOpen(r['Status']); }).length
  };
}

/** Top items needing management attention, most-urgent category first (Delayed clients > Critical issues > Blocked tasks > Stale requests), capped at 15. */
function buildManagementAttentionSection(clients, issues, tasks, requests) {
  var items = [];

  clients.filter(function (c) { return c['Client Health'] === 'Delayed'; }).forEach(function (c) {
    items.push({ type: 'Client Delayed', label: c['Client Name'] });
  });

  issues.filter(function (i) { return isIssueOpen(i['Status']) && i['Severity'] === 'Critical'; }).forEach(function (i) {
    items.push({ type: 'Critical Issue', label: i['Issue'] + ' (' + i['Client'] + ')' });
  });

  tasks.filter(function (t) { return t['Status'] === 'Blocked'; }).forEach(function (t) {
    items.push({ type: 'Blocked Task', label: t['Task Name'] + ' (' + t['Client Name'] + ')' });
  });

  var staleIds = flagStaleRequests(requests.filter(function (r) { return isRequestOpen(r['Status']); }), CONST.REQUEST_STALE_DAYS);
  requests.filter(function (r) { return staleIds.indexOf(r['Request ID']) !== -1; }).forEach(function (r) {
    items.push({ type: 'Stale Request', label: r['Request'] + ' (' + r['Client'] + ')' });
  });

  return items.slice(0, 15);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildManagementReport: buildManagementReport };
}
