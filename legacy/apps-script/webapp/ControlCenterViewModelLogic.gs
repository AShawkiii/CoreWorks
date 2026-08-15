/**
 * Pure Control Center view-model assembly for the Web App — no Apps Script
 * globals, Node-testable (same pure-logic/IO split as the rest of the
 * codebase, architecture.md §8; mirrors dashboards/ManagementReportLogic.gs
 * most closely, since both build a JSON-shaped object rather than write
 * cells). Takes plain row arrays (as returned by getAllRows) plus an
 * explicit `today`; webapp/ControlCenterViewModelService.gs is the only
 * caller that touches SpreadsheetApp.
 *
 * Deliberately reuses existing rules rather than re-deriving them:
 * - Client Health is read directly from CLIENTS.Client Health (already
 *   computed by clients/HealthEngine.gs) — not recomputed here.
 * - Completion % is read directly from CLIENTS.Weighted Completion %
 *   (already computed by tasks/ProgressEngine.gs).
 * - Overdue-ness uses utils/DateLogic.gs::computeDaysOverdue (same
 *   function TASKS' own formula and clients/HealthEngine.gs use).
 * - Task-count KPIs are unscoped by client Contract Status, matching
 *   dashboards/ControlCenterSheetBuilder.gs's existing live KPI formulas
 *   exactly (e.g. Overdue Tasks = COUNTIF(TASKS!Q:Q,">0") over ALL tasks).
 * - Surfaced issues use issues/IssueLogic.gs::selectSurfacedIssues — the
 *   exact same function issues/IssueService.gs::getSurfacedIssuesForControlCenter()
 *   calls for the spreadsheet Control Center.
 */
function buildControlCenterViewModel(clients, tasks, issues, today) {
  return {
    kpis: buildControlCenterKpis(clients, tasks, issues, today),
    clientHealth: buildClientHealthRows(clients, tasks, issues, today),
    surfacedIssues: buildSurfacedIssueRows(issues, today),
    generatedAt: today
  };
}

/** Returns an ordered array of {key, label, value, format} KPI cards — a superset of the spreadsheet Control Center's 9 KPIs plus the additional counts requested for the Web App. */
function buildControlCenterKpis(clients, tasks, issues, today) {
  var activeClients = clients.filter(function (c) { return c['Contract Status'] === 'Active'; });
  var onboardingClients = clients.filter(function (c) { return c['Contract Status'] === 'Onboarding'; });
  var onHoldClients = clients.filter(function (c) { return c['Contract Status'] === 'On Hold'; });
  var atRiskClients = clients.filter(function (c) { return c['Client Health'] === 'At Risk'; });
  var delayedClients = clients.filter(function (c) { return c['Client Health'] === 'Delayed'; });

  var countedTasks = tasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });
  var openTasks = countedTasks.filter(function (t) { return isTaskOpen(t['Status']); });
  var overdueTasks = countedTasks.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; });
  var completedTasks = countedTasks.filter(function (t) { return t['Status'] === 'Completed'; });
  var waitingClientTasks = countedTasks.filter(function (t) { return t['Status'] === 'Waiting Client'; });
  var blockedTasks = countedTasks.filter(function (t) { return t['Status'] === 'Blocked'; });

  var openIssues = issues.filter(function (i) { return isIssueOpen(i['Status']); });
  var attentionIssues = selectSurfacedIssues(issues, today);

  var completionValues = clients.map(function (c) { return Number(c['Weighted Completion %']) || 0; });
  var overallCompletionPct = completionValues.length
    ? completionValues.reduce(function (a, b) { return a + b; }, 0) / completionValues.length
    : 0;

  return [
    { key: 'totalClients', label: 'Total Clients', value: clients.length, format: 'count' },
    { key: 'activeClients', label: 'Active Clients', value: activeClients.length, format: 'count' },
    { key: 'onboardingClients', label: 'Onboarding', value: onboardingClients.length, format: 'count' },
    { key: 'onHoldClients', label: 'On Hold', value: onHoldClients.length, format: 'count' },
    { key: 'clientsAtRisk', label: 'Clients At Risk', value: atRiskClients.length, format: 'count' },
    { key: 'clientsDelayed', label: 'Clients Delayed', value: delayedClients.length, format: 'count' },
    { key: 'overallCompletionPct', label: 'Overall Completion %', value: overallCompletionPct, format: 'percent' },
    { key: 'openTasks', label: 'Open Tasks', value: openTasks.length, format: 'count' },
    { key: 'overdueTasks', label: 'Overdue Tasks', value: overdueTasks.length, format: 'count' },
    { key: 'tasksCompleted', label: 'Tasks Completed', value: completedTasks.length, format: 'count' },
    { key: 'waitingOnClient', label: 'Waiting on Client', value: waitingClientTasks.length, format: 'count' },
    { key: 'blockedTasks', label: 'Blocked Tasks', value: blockedTasks.length, format: 'count' },
    { key: 'openIssues', label: 'Open Issues', value: openIssues.length, format: 'count' },
    { key: 'issuesNeedingAttention', label: 'Issues Needing Attention', value: attentionIssues.length, format: 'count' }
  ];
}

/**
 * One row per ACTIVE client (the Control Center's health table shows the
 * live roster, matching what "Total Active Clients" is meant to represent —
 * On Hold/Onboarding clients are visible via their own KPI cards instead).
 * Sorted most-urgent health first, then alphabetically, as a display-only
 * convenience — not a business rule change.
 */
function buildClientHealthRows(clients, tasks, issues, today) {
  var tasksByClient = groupRowsByClientId(tasks);
  var issuesByClient = groupRowsByClientId(issues);

  var rows = clients
    .filter(function (c) { return c['Contract Status'] === 'Active'; })
    .map(function (c) {
      var clientTasks = tasksByClient[c['Client ID']] || [];
      var clientIssues = issuesByClient[c['Client ID']] || [];

      var overdueTasks = clientTasks.filter(function (t) { return computeDaysOverdue(t['Due Date'], t['Status'], today) > 0; }).length;
      var waitingOnClient = clientTasks.filter(function (t) { return t['Status'] === 'Waiting Client'; }).length;
      var openIssues = clientIssues.filter(function (i) { return isIssueOpen(i['Status']); }).length;

      return {
        clientId: c['Client ID'],
        clientName: c['Client Name'],
        servicePackage: c['Service Package'],
        accountManager: c['Account Manager'],
        health: c['Client Health'],
        completionPct: Number(c['Weighted Completion %']) || 0,
        overdueTasks: overdueTasks,
        waitingOnClient: waitingOnClient,
        openIssues: openIssues,
        nextDeadline: c['Next Deadline'] || null
      };
    });

  return rows.sort(function (a, b) {
    var rankDiff = healthSortRank(a.health) - healthSortRank(b.health);
    if (rankDiff !== 0) return rankDiff;
    return String(a.clientName).localeCompare(String(b.clientName));
  });
}

var CLIENT_HEALTH_SORT_RANK = { 'Delayed': 0, 'At Risk': 1, 'On Track': 2, 'On Hold': 3 };

/**
 * Looks up a health's sort rank. NOT "CLIENT_HEALTH_SORT_RANK[health] || 99" —
 * 'Delayed' legitimately ranks 0, and 0 is falsy in JS, so that pattern
 * would silently treat Delayed as unranked (99) and defeat the whole
 * "most urgent first" sort. hasOwnProperty avoids that trap.
 */
function healthSortRank(health) {
  return Object.prototype.hasOwnProperty.call(CLIENT_HEALTH_SORT_RANK, health) ? CLIENT_HEALTH_SORT_RANK[health] : 99;
}

/** Reuses issues/IssueLogic.gs::selectSurfacedIssues verbatim — the exact rule the spreadsheet Control Center already uses. */
function buildSurfacedIssueRows(issues, today) {
  return selectSurfacedIssues(issues, today).map(function (i) {
    return {
      issueId: i['Issue ID'],
      clientId: i['Client ID'],
      clientName: i['Client'],
      issue: i['Issue'],
      severity: i['Severity'],
      status: i['Status'],
      owner: i['Assigned To'],
      daysOpen: i['Date Raised'] ? daysBetween(today, i['Date Raised']) : null,
      dueDate: i['Deadline'] || null
    };
  });
}

function groupRowsByClientId(rows) {
  var grouped = {};
  rows.forEach(function (row) {
    var clientId = row['Client ID'];
    if (!grouped[clientId]) grouped[clientId] = [];
    grouped[clientId].push(row);
  });
  return grouped;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildControlCenterViewModel: buildControlCenterViewModel,
    buildControlCenterKpis: buildControlCenterKpis,
    buildClientHealthRows: buildClientHealthRows,
    buildSurfacedIssueRows: buildSurfacedIssueRows,
    groupRowsByClientId: groupRowsByClientId,
    healthSortRank: healthSortRank,
    CLIENT_HEALTH_SORT_RANK: CLIENT_HEALTH_SORT_RANK
  };
}
