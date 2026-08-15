/**
 * IO wrapper around IssueLogic.gs.
 */
function createIssue(fields) {
  var issue = Object.assign({}, fields);
  if (!issue['Client ID'] || !issue['Issue']) {
    throw new Error('createIssue(): Client ID and Issue are required.');
  }
  issue['Issue ID'] = generateNextId('ISSUES');
  issue['Status'] = issue['Status'] || 'Open';
  issue['Date Raised'] = issue['Date Raised'] || new Date();

  appendRow('ISSUES', issue);
  logActivity('Issue Created', 'Issue', issue['Issue ID'], '', issue['Issue'], issue['Client'] || '');
  return issue;
}

/** Marks an issue Resolved and stamps Resolution Date (defaults to today). */
function resolveIssue(issueId, resolutionDate) {
  var issue = getAllRows('ISSUES').filter(function (i) { return i['Issue ID'] === issueId; })[0];
  if (!issue) throw new Error('resolveIssue(): no issue found with ID ' + issueId);

  var previousStatus = issue['Status'];
  updateRowById('ISSUES', 'Issue ID', issueId, {
    'Status': 'Resolved',
    'Resolution Date': resolutionDate || new Date()
  });

  if (previousStatus !== 'Resolved') {
    logActivity('Issue Resolved', 'Issue', issueId, previousStatus, 'Resolved', issue['Client'] || '');
  }
}

/** Issues to surface on the Control Center (Phase 15): Critical/High or overdue, unresolved. */
function getSurfacedIssuesForControlCenter() {
  return selectSurfacedIssues(getAllRows('ISSUES'), new Date());
}
