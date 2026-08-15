/**
 * IO wrapper around ClientRequestLogic.gs.
 */
function createClientRequest(fields) {
  var request = Object.assign({}, fields);
  if (!request['Client ID'] || !request['Request']) {
    throw new Error('createClientRequest(): Client ID and Request are required.');
  }
  request['Request ID'] = generateNextId('CLIENT_REQUESTS');
  request['Status'] = request['Status'] || 'Requested';
  request['Requested Date'] = request['Requested Date'] || new Date();

  appendRow('CLIENT_REQUESTS', request);
  logActivity('Client Request Created', 'Client Request', request['Request ID'], '', request['Request'], request['Client'] || '');
  return request;
}

/** Updates a request's Status; stamps Received Date when moving to 'Received' (defaults to today unless explicitly provided). */
function updateRequestStatus(requestId, newStatus, receivedDate) {
  var request = getAllRows('CLIENT_REQUESTS').filter(function (r) { return r['Request ID'] === requestId; })[0];
  if (!request) throw new Error('updateRequestStatus(): no request found with ID ' + requestId);

  var previousStatus = request['Status'];
  var patch = { 'Status': newStatus };
  if (newStatus === 'Received') {
    patch['Received Date'] = receivedDate || new Date();
  }

  updateRowById('CLIENT_REQUESTS', 'Request ID', requestId, patch);

  if (previousStatus !== newStatus) {
    logActivity('Client Request Status Changed', 'Client Request', requestId, previousStatus, newStatus, request['Client'] || '');
  }
}

/** Summary for dashboards (Phase 14): open request count, stale (15+ day) request IDs, and top clients by outstanding count. */
function getOutstandingRequestsSummary() {
  var requests = getAllRows('CLIENT_REQUESTS');
  var open = requests.filter(function (r) { return isRequestOpen(r['Status']); });
  var staleDays = Number(getSetting('REQUESTS', 'REQUEST_STALE_DAYS', CONST.REQUEST_STALE_DAYS));

  return {
    openCount: open.length,
    staleRequestIds: flagStaleRequests(open, staleDays),
    topClients: topClientsByOutstandingRequests(open, 5)
  };
}
