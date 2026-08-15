/**
 * IO wrapper around HealthLogic.gs. Deliberately recomputes overdue-ness
 * from raw Due Date + Status via utils/DateLogic.gs rather than trusting
 * TASKS' live "Days Overdue" formula column — both always agree (they're
 * the same rule, see DateLogic.gs's docblock), but this keeps the engine
 * correct even the instant a status changes, before Sheets has recalculated
 * the formula, and needs no special-casing when run outside a live sheet.
 */
function recalculateClientHealth(clientId) {
  var client = getAllRows('CLIENTS').filter(function (c) { return c['Client ID'] === clientId; })[0];
  if (!client) throw new Error('recalculateClientHealth(): no client found with ID ' + clientId);

  var today = new Date();
  var tasks = getTasksForClient(clientId);
  var issues = getAllRows('ISSUES').filter(function (i) { return i['Client ID'] === clientId; });

  var overdueCount = 0;
  var criticalOverdueCount = 0;
  tasks.forEach(function (t) {
    if (computeDaysOverdue(t['Due Date'], t['Status'], today) > 0) {
      overdueCount++;
      if (t['Priority'] === 'Critical') criticalOverdueCount++;
    }
  });

  var openCriticalIssueCount = issues.filter(function (i) { return isIssueOpen(i['Status']) && i['Severity'] === 'Critical'; }).length;
  var openHighIssueCount = issues.filter(function (i) { return isIssueOpen(i['Status']) && i['Severity'] === 'High'; }).length;

  var importantTasks = tasks.filter(function (t) { return t['Priority'] === 'Critical' || t['Priority'] === 'High'; });
  var nextImportantDeadline = computeNextDeadline(importantTasks); // reuses ProgressLogic's "earliest open due date" over a Critical/High-only subset
  var daysToNextImportantDeadline = nextImportantDeadline ? daysBetween(nextImportantDeadline, today) : null;

  var thresholds = {
    delayedTotalOverdueCount: Number(getSetting('HEALTH', 'HEALTH_DELAYED_TOTAL_OVERDUE_COUNT', CONST.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT)),
    atRiskOverdueCount: Number(getSetting('HEALTH', 'HEALTH_AT_RISK_OVERDUE_COUNT', CONST.HEALTH_AT_RISK_OVERDUE_COUNT)),
    atRiskDueSoonDays: Number(getSetting('HEALTH', 'HEALTH_AT_RISK_DUE_SOON_DAYS', CONST.HEALTH_AT_RISK_DUE_SOON_DAYS))
  };

  var stats = {
    contractStatus: client['Contract Status'],
    overdueCount: overdueCount,
    criticalOverdueCount: criticalOverdueCount,
    openCriticalIssueCount: openCriticalIssueCount,
    openHighIssueCount: openHighIssueCount,
    daysToNextImportantDeadline: daysToNextImportantDeadline
  };

  var newHealth = computeClientHealth(stats, thresholds);
  var previousHealth = client['Client Health'];

  updateRowById('CLIENTS', 'Client ID', clientId, { 'Client Health': newHealth });

  if (previousHealth !== newHealth) {
    logActivity('Client Health Changed', 'Client', clientId, previousHealth, newHealth, client['Client Name']);
  }

  return newHealth;
}

/** Recalculates health for every client — the daily safety-net pass. */
function recalculateAllClientsHealth() {
  getAllRows('CLIENTS').forEach(function (c) { recalculateClientHealth(c['Client ID']); });
}
