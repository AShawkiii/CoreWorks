/**
 * Pure issue logic — no Apps Script globals, Node-testable.
 */
function isIssueOpen(status) {
  return ENUMS.ISSUE_STATUS.open.indexOf(status) !== -1;
}

function isUnresolvedCriticalOrHigh(issue) {
  return isIssueOpen(issue['Status']) && (issue['Severity'] === 'Critical' || issue['Severity'] === 'High');
}

/** An open issue whose Deadline has passed. */
function isOverdueIssue(issue, today) {
  if (!isIssueOpen(issue['Status']) || !issue['Deadline']) return false;
  return daysBetween(today, issue['Deadline']) > 0;
}

/** Surfacing rule for the Control Center (Phase 15): Critical/High severity OR overdue, and still unresolved. Sorted most-severe, then oldest, first. */
function selectSurfacedIssues(issues, today) {
  var surfaced = issues.filter(function (i) { return isUnresolvedCriticalOrHigh(i) || isOverdueIssue(i, today); });
  return surfaced.slice().sort(function (a, b) {
    var severityDiff = (ENUMS.PRIORITY.weights[b['Severity']] || 0) - (ENUMS.PRIORITY.weights[a['Severity']] || 0);
    if (severityDiff !== 0) return severityDiff;
    return new Date(a['Date Raised']) - new Date(b['Date Raised']);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isIssueOpen: isIssueOpen,
    isUnresolvedCriticalOrHigh: isUnresolvedCriticalOrHigh,
    isOverdueIssue: isOverdueIssue,
    selectSurfacedIssues: selectSurfacedIssues
  };
}
