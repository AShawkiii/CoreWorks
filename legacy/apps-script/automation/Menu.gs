/**
 * Custom "Finance Lab" menu (Phase 18) — the primary navigation surface,
 * built fresh on every onOpen. Complements the in-sheet hyperlink nav rows
 * (dashboards/NavigationUtils.gs).
 */
function buildCustomMenu() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('Finance Lab');

  menu.addItem('Go to Control Center', 'navigateToControlCenter');
  menu.addItem('Go to Clients', 'navigateToClients');
  menu.addItem('Go to Tasks', 'navigateToTasks');
  menu.addItem('Go to Monthly Close', 'navigateToMonthlyClose');
  menu.addItem('Go to Client Requests', 'navigateToClientRequests');
  menu.addItem('Go to Issues', 'navigateToIssues');
  menu.addItem('Go to Team Dashboard', 'navigateToTeamDashboard');
  menu.addItem('Go to Client Dashboard', 'navigateToClientDashboard');
  menu.addItem('Go to Settings', 'navigateToSettings');

  menu.addSeparator();
  menu.addItem('Run: Generate Monthly Tasks', 'menuRunGenerateMonthlyTasks');
  menu.addItem('Run: Recalculate All', 'menuRunRecalculateAll');
  menu.addItem('Run: Rebuild Dashboards', 'menuRunRebuildDashboards');
  menu.addItem('Run: Generate Management Report', 'menuRunGenerateManagementReport');
  menu.addSeparator();
  menu.addItem('Setup / Repair System', 'setupSpreadsheet');

  menu.addToUi();
}

// Explicit one-liners rather than a table-driven generator — Apps Script
// menu handlers must be bare global function names known at bind time, and
// spelling them out is more debuggable than reconstructing them dynamically.
function navigateToControlCenter() { SpreadsheetApp.getActive().setActiveSheet(getSheet('CONTROL_CENTER')); }
function navigateToClients() { SpreadsheetApp.getActive().setActiveSheet(getSheet('CLIENTS')); }
function navigateToTasks() { SpreadsheetApp.getActive().setActiveSheet(getSheet('TASKS')); }
function navigateToMonthlyClose() { SpreadsheetApp.getActive().setActiveSheet(getSheet('MONTHLY_CLOSE')); }
function navigateToClientRequests() { SpreadsheetApp.getActive().setActiveSheet(getSheet('CLIENT_REQUESTS')); }
function navigateToIssues() { SpreadsheetApp.getActive().setActiveSheet(getSheet('ISSUES')); }
function navigateToTeamDashboard() { SpreadsheetApp.getActive().setActiveSheet(getSheet('TEAM_DASHBOARD')); }
function navigateToClientDashboard() { SpreadsheetApp.getActive().setActiveSheet(getSheet('CLIENT_DASHBOARD')); }
function navigateToSettings() { SpreadsheetApp.getActive().setActiveSheet(getSheet('SETTINGS')); }

function menuRunGenerateMonthlyTasks() {
  var result = generateMonthlyTasks();
  SpreadsheetApp.getActive().toast(result.tasksCreated + ' task(s) created for ' + result.clientsProcessed + ' client(s), period ' + result.period + '.', 'Finance Lab', 6);
}

function menuRunRecalculateAll() {
  recalculateAllClientsProgress();
  recalculateAllClientsHealth();
  SpreadsheetApp.getActive().toast('Progress and health recalculated for all clients.', 'Finance Lab', 5);
}

function menuRunRebuildDashboards() {
  renderControlCenter();
  buildControlCenterCharts();
  renderClientDashboard();
  renderTeamDashboard();
  renderMonthlyCloseDashboard();
  SpreadsheetApp.getActive().toast('Dashboards rebuilt.', 'Finance Lab', 5);
}

function menuRunGenerateManagementReport() {
  generateMonthlyManagementReport();
  SpreadsheetApp.getActive().toast('Management report generated.', 'Finance Lab', 5);
}
