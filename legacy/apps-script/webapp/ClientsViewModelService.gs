/**
 * IO wrapper around ClientsViewModelLogic.gs — the Web App's
 * google.script.run entry points for the Clients list and Client Detail
 * views. Read-only: reuses utils/SheetUtils.gs::getAllRows() (unmodified)
 * against CLIENTS/TASKS/ISSUES/CLIENT_REQUESTS, the same sheets
 * dashboards/ClientDashboardEngine.gs reads for the spreadsheet's Client
 * Dashboard — does not call that engine directly since it writes cells
 * and returns nothing.
 *
 * JSON.parse(JSON.stringify(...)) before returning, same as
 * ControlCenterViewModelService.gs — google.script.run cannot safely
 * return raw Date objects.
 */
function getClientsListViewModel() {
  var clients = getAllRows('CLIENTS');
  var vm = buildClientsListViewModel(clients);
  return JSON.parse(JSON.stringify(vm));
}

/** Returns null (not an error) if clientId doesn't match any CLIENTS row — the frontend renders a "client not found" state for that. */
function getClientDetailViewModel(clientId) {
  var clients = getAllRows('CLIENTS');
  var tasks = getAllRows('TASKS');
  var issues = getAllRows('ISSUES');
  var requests = getAllRows('CLIENT_REQUESTS');
  var vm = buildClientDetailViewModel(clientId, clients, tasks, issues, requests, new Date());
  return JSON.parse(JSON.stringify(vm));
}
