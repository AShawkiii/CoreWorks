/**
 * Central registry of every sheet's tab name. Nothing outside this file should
 * ever write a sheet name as a string literal — reference SHEETS.<KEY> instead.
 */
var SHEETS = {
  CONTROL_CENTER: 'CONTROL_CENTER',
  CLIENTS: 'CLIENTS',
  EMPLOYEES: 'EMPLOYEES',
  SERVICES: 'SERVICES',
  SERVICE_PACKAGES: 'SERVICE_PACKAGES',
  TASK_TEMPLATES: 'TASK_TEMPLATES',
  TASKS: 'TASKS',
  CLIENT_REQUESTS: 'CLIENT_REQUESTS',
  ISSUES: 'ISSUES',
  ACTIVITY_LOG: 'ACTIVITY_LOG',
  MONTHLY_CLOSE: 'MONTHLY_CLOSE',
  SETTINGS: 'SETTINGS',
  CLIENT_DASHBOARD: 'CLIENT_DASHBOARD',
  TEAM_DASHBOARD: 'TEAM_DASHBOARD',
  MONTHLY_CLOSE_DASHBOARD: 'MONTHLY_CLOSE_DASHBOARD',
  MANAGEMENT_REPORT: 'MANAGEMENT_REPORT',
  CHART_SRC: '_CHART_SRC'
};

// Sheets that are pure data tables with a fixed header row + SCHEMAS entry.
// Dashboards/report/chart-source sheets are layout-driven and are NOT in this list —
// their cell positions are defined by their own builder files, not by Schemas.gs.
var DATA_SHEET_KEYS = [
  'CLIENTS', 'EMPLOYEES', 'SERVICES', 'SERVICE_PACKAGES', 'TASK_TEMPLATES',
  'TASKS', 'CLIENT_REQUESTS', 'ISSUES', 'ACTIVITY_LOG', 'MONTHLY_CLOSE', 'SETTINGS'
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SHEETS: SHEETS, DATA_SHEET_KEYS: DATA_SHEET_KEYS };
}
