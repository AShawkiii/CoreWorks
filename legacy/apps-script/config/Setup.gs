/**
 * setupSpreadsheet() is the single entry point a user runs (from the Apps
 * Script editor, after clasp push) to build/rebuild the entire system. It is
 * safe to re-run at any time: every builder function is idempotent — it
 * never deletes existing data rows, only rebuilds headers, formulas,
 * validation, protection, and formatting (architecture.md / Constants.gs
 * "idempotent setup" convention).
 *
 * Order matters: a sheet that data-validates against another sheet's column
 * (e.g. CLIENTS.Service Package -> SERVICE_PACKAGES.Package Name) must be
 * built AFTER the sheet it references. See requirements.md / architecture.md
 * for the full dependency reasoning.
 *
 * Does NOT call buildCustomMenu() — SpreadsheetApp.getUi() throws outside a
 * live editor UI context (e.g. if setup is ever run from a trigger), and
 * onOpen() (automation/Triggers.gs) already builds the menu on every open,
 * including the next open right after running this.
 */
function setupSpreadsheet() {
  buildSettingsSheet();
  buildEmployeesSheet();
  buildServicesSheet();
  buildServicePackagesSheet();
  buildClientsSheet();
  buildTaskTemplatesSheet();
  seedTaskTemplates();
  buildTasksSheet();
  buildClientRequestsSheet();
  buildIssuesSheet();
  buildActivityLogSheet();
  buildMonthlyCloseSheet();
  buildControlCenterSheet();
  buildClientDashboardSheet();
  buildTeamDashboardSheet();
  buildMonthlyCloseDashboardSheet();
  buildChartSourceSheet();

  installNavigationRows();
  installTimeDrivenTriggers();

  renderControlCenter();
  buildControlCenterCharts();
  generateMonthlyManagementReport();

  Logger.log('setupSpreadsheet() complete.');
}
