/**
 * Pure client-request logic — no Apps Script globals, Node-testable.
 * Operates on request rows that already carry a numeric 'Days Waiting'
 * (Sheets computes it live via ARRAYFORMULA — see
 * requests/ClientRequestsSheetBuilder.gs — so the IO layer never needs to
 * recompute it, only read the column).
 */
function isRequestOpen(status) {
  return ENUMS.REQUEST_STATUS.open.indexOf(status) !== -1;
}

/** Request IDs for open requests waiting `staleDaysThreshold`+ days (Phase 14's 15+ flag, threshold from SETTINGS). */
function flagStaleRequests(requests, staleDaysThreshold) {
  return requests
    .filter(function (r) { return isRequestOpen(r['Status']) && Number(r['Days Waiting']) >= staleDaysThreshold; })
    .map(function (r) { return r['Request ID']; });
}

/** Top N clients by count of currently-open requests, descending. */
function topClientsByOutstandingRequests(requests, n) {
  var counts = {};
  requests.filter(function (r) { return isRequestOpen(r['Status']); }).forEach(function (r) {
    counts[r['Client']] = (counts[r['Client']] || 0) + 1;
  });
  return Object.keys(counts)
    .map(function (client) { return { client: client, count: counts[client] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, n || 5);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isRequestOpen: isRequestOpen,
    flagStaleRequests: flagStaleRequests,
    topClientsByOutstandingRequests: topClientsByOutstandingRequests
  };
}
