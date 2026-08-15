/**
 * Pure client health rule set — no Apps Script globals, Node-testable.
 * Mirrors architecture.md §7 exactly. `stats` and `thresholds` are plain
 * objects so this function never touches TASKS/ISSUES/SETTINGS itself —
 * clients/HealthEngine.gs gathers them.
 *
 * stats: { contractStatus, overdueCount, criticalOverdueCount,
 *          openCriticalIssueCount, openHighIssueCount,
 *          daysToNextImportantDeadline }
 * thresholds: { delayedTotalOverdueCount, atRiskOverdueCount, atRiskDueSoonDays }
 *
 * `daysToNextImportantDeadline` is deliberately scoped to Critical/High
 * priority open tasks only (not the client's next deadline of ANY
 * priority) — otherwise every client with routine recurring work due in
 * the next few days would trip "At Risk" permanently, which isn't a
 * meaningful signal. "An important deadline is coming up soon" is;
 * "something is due this week" isn't.
 */
function computeClientHealth(stats, thresholds) {
  if (stats.contractStatus === 'On Hold') return 'On Hold';

  if (stats.criticalOverdueCount > 0 ||
      stats.overdueCount >= thresholds.delayedTotalOverdueCount ||
      stats.openCriticalIssueCount > 0) {
    return 'Delayed';
  }

  var importantDeadlineDueSoon = stats.daysToNextImportantDeadline !== null &&
    stats.daysToNextImportantDeadline >= 0 &&
    stats.daysToNextImportantDeadline <= thresholds.atRiskDueSoonDays;

  if (stats.overdueCount >= thresholds.atRiskOverdueCount ||
      importantDeadlineDueSoon ||
      stats.openHighIssueCount > 0) {
    return 'At Risk';
  }

  return 'On Track';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeClientHealth: computeClientHealth };
}
