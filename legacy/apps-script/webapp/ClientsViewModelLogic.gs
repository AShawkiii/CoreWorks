/**
 * Pure Clients (list + detail) view-model assembly for the Web App — no
 * Apps Script globals, Node-testable (architecture.md §8; same pattern as
 * webapp/ControlCenterViewModelLogic.gs, including reusing its
 * healthSortRank() directly since both files load into the same Apps
 * Script global namespace).
 *
 * Per-client scoping (Client ID match + open-status filter for issues/
 * requests) mirrors the EXISTING precedent in
 * dashboards/ClientDashboardEngine.gs::writeIssuesTable/
 * writeClientRequestsTable exactly — not a new pattern. Task/issue/
 * request rules reused, not re-derived: isTaskOpen (tasks/TaskLogic.gs),
 * isIssueOpen (issues/IssueLogic.gs), isRequestOpen
 * (requests/ClientRequestLogic.gs), computeDaysRemaining
 * (utils/DateLogic.gs). Client Health / Simple+Weighted Completion % are
 * read directly from CLIENTS, not recomputed — same reasoning as
 * ControlCenterViewModelLogic.gs.
 */

/** One row per client (ALL clients, not just Active — the Clients page has its own status/health filters), default-sorted most-urgent-health-first. */
function buildClientsListViewModel(clients) {
  var rows = clients.map(function (c) {
    return {
      clientId: c['Client ID'],
      clientName: c['Client Name'],
      servicePackage: c['Service Package'],
      accountManager: c['Account Manager'],
      contractStatus: c['Contract Status'],
      health: c['Client Health'],
      completionPct: Number(c['Weighted Completion %']) || 0,
      nextDeadline: c['Next Deadline'] || null
    };
  });

  return rows.sort(function (a, b) {
    var rankDiff = healthSortRank(a.health) - healthSortRank(b.health);
    if (rankDiff !== 0) return rankDiff;
    return String(a.clientName).localeCompare(String(b.clientName));
  });
}

/**
 * Full detail view for one client, or null if clientId doesn't match any
 * CLIENTS row (the Web App shows a "client not found" state for that).
 * Tasks/Issues/Requests sections show only OPEN items, matching
 * dashboards/ClientDashboardEngine.gs's existing Client Dashboard sheet
 * precedent for the same 3 sections.
 */
function buildClientDetailViewModel(clientId, clients, tasks, issues, requests, today) {
  var client = clients.filter(function (c) { return c['Client ID'] === clientId; })[0];
  if (!client) return null;

  var openTasks = tasks.filter(function (t) { return t['Client ID'] === clientId && isTaskOpen(t['Status']); });
  var openIssues = issues.filter(function (i) { return i['Client ID'] === clientId && isIssueOpen(i['Status']); });
  var openRequests = requests.filter(function (r) { return r['Client ID'] === clientId && isRequestOpen(r['Status']); });

  return {
    clientId: client['Client ID'],
    clientName: client['Client Name'],
    companyName: client['Company Name'],
    industry: client['Industry'],
    businessType: client['Business Type'],
    servicePackage: client['Service Package'],
    accountManager: client['Account Manager'],
    backupTeamMember: client['Backup Team Member'],
    clientContact: client['Client Contact'],
    email: client['Email'],
    phone: client['Phone'],
    contractStatus: client['Contract Status'],
    priority: client['Priority'],
    health: client['Client Health'],
    simpleCompletionPct: Number(client['Simple Completion %']) || 0,
    weightedCompletionPct: Number(client['Weighted Completion %']) || 0,
    lastActivity: client['Last Activity'] || null,
    nextDeadline: client['Next Deadline'] || null,
    notes: client['Notes'] || '',
    tasks: buildClientDetailTaskRows(openTasks, today),
    issues: buildClientDetailIssueRows(openIssues),
    requests: buildClientDetailRequestRows(openRequests)
  };
}

/** Open tasks, soonest due date first; tasks with no due date sort last (not first — a missing date isn't "most urgent"). */
function buildClientDetailTaskRows(tasks, today) {
  var rows = tasks.map(function (t) {
    return {
      taskId: t['Task ID'],
      taskName: t['Task Name'],
      serviceArea: t['Service Area'],
      status: t['Status'],
      priority: t['Priority'],
      assignedTo: t['Assigned To'],
      dueDate: t['Due Date'] || null,
      daysRemaining: computeDaysRemaining(t['Due Date'], t['Status'], today),
      reviewStatus: t['Review Status']
    };
  });

  return rows.sort(function (a, b) { return taskDueDateSortKey(a.dueDate) - taskDueDateSortKey(b.dueDate); });
}

function taskDueDateSortKey(dueDate) {
  return dueDate ? new Date(dueDate).getTime() : Infinity;
}

/** Open issues, most severe first (same PRIORITY.weights lookup issues/IssueLogic.gs::selectSurfacedIssues uses for its own severity ordering). */
function buildClientDetailIssueRows(issues) {
  var rows = issues.map(function (i) {
    return {
      issueId: i['Issue ID'],
      issue: i['Issue'],
      category: i['Category'],
      severity: i['Severity'],
      status: i['Status'],
      owner: i['Assigned To'],
      dateRaised: i['Date Raised'] || null,
      deadline: i['Deadline'] || null,
      requiredAction: i['Required Action']
    };
  });

  return rows.sort(function (a, b) { return issueSeverityRank(b.severity) - issueSeverityRank(a.severity); });
}

function issueSeverityRank(severity) {
  return (ENUMS.PRIORITY.weights && ENUMS.PRIORITY.weights[severity]) || 0;
}

/** Open requests, longest-waiting first. Days Waiting is read directly from the sheet's own live ARRAYFORMULA column — not recomputed. */
function buildClientDetailRequestRows(requests) {
  var rows = requests.map(function (r) {
    var daysWaiting = (r['Days Waiting'] === '' || r['Days Waiting'] === null || typeof r['Days Waiting'] === 'undefined')
      ? null
      : Number(r['Days Waiting']);
    return {
      requestId: r['Request ID'],
      request: r['Request'],
      status: r['Status'],
      requestedDate: r['Requested Date'] || null,
      requiredBy: r['Required By'] || null,
      daysWaiting: daysWaiting,
      daysWaitingBucket: r['Days Waiting Bucket'] || null,
      assignedTo: r['Assigned To']
    };
  });

  return rows.sort(function (a, b) { return (b.daysWaiting || 0) - (a.daysWaiting || 0); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildClientsListViewModel: buildClientsListViewModel,
    buildClientDetailViewModel: buildClientDetailViewModel,
    buildClientDetailTaskRows: buildClientDetailTaskRows,
    buildClientDetailIssueRows: buildClientDetailIssueRows,
    buildClientDetailRequestRows: buildClientDetailRequestRows,
    issueSeverityRank: issueSeverityRank,
    taskDueDateSortKey: taskDueDateSortKey
  };
}
