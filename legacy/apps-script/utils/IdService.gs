/**
 * IO wrapper around IdLogic.gs — reads existing IDs from the relevant sheet
 * and returns the next sequential one. Monthly Close IDs are composite
 * (MC-<ClientID>-<YYYYMM>) and are NOT generated here — see
 * tasks/MonthlyCloseService.gs.
 */
var ID_CONFIG = {
  CLIENTS: { prefix: 'CL-', padWidth: 4, idColumn: 'Client ID' },
  EMPLOYEES: { prefix: 'EMP-', padWidth: 3, idColumn: 'Employee ID' },
  TASKS: { prefix: 'TSK-', padWidth: 6, idColumn: 'Task ID' },
  TASK_TEMPLATES: { prefix: 'TPL-', padWidth: 3, idColumn: 'Template ID' },
  CLIENT_REQUESTS: { prefix: 'REQ-', padWidth: 4, idColumn: 'Request ID' },
  ISSUES: { prefix: 'ISS-', padWidth: 4, idColumn: 'Issue ID' },
  ACTIVITY_LOG: { prefix: 'ACT-', padWidth: 7, idColumn: 'Activity ID' },
  SERVICES: { prefix: 'SVC-', padWidth: 3, idColumn: 'Service ID' },
  SERVICE_PACKAGES: { prefix: 'PKG-', padWidth: 3, idColumn: 'Package ID' }
};

/** Generates the next sequential ID for the given sheet key (e.g. 'CLIENTS' -> 'CL-0008'). */
function generateNextId(sheetKey) {
  var config = ID_CONFIG[sheetKey];
  if (!config) throw new Error('generateNextId(): no ID config for sheet key "' + sheetKey + '"');
  var rows = getAllRows(sheetKey);
  var existingIds = rows.map(function (r) { return r[config.idColumn]; });
  return nextSequentialId(existingIds, config.prefix, config.padWidth);
}

/** Builds the composite Monthly Close ID for a client + period ("YYYY-MM"). */
function buildMonthlyCloseId(clientId, period) {
  return 'MC-' + clientId + '-' + period.replace('-', '');
}
