/**
 * IO wrapper around ProgressLogic.gs — writes CLIENTS.Simple Completion % /
 * Weighted Completion % / Next Deadline. Called after task generation
 * (clients/ClientService.gs, tasks/TaskGenerationMonthly.gs) and by the
 * daily recalculation trigger (automation/Triggers.gs, Stage 7).
 */
function recalculateClientProgress(clientId) {
  var tasks = getTasksForClient(clientId);
  var simple = computeSimpleCompletion(tasks);
  var weighted = computeWeightedCompletion(tasks, ENUMS.PRIORITY.weights);
  var nextDeadline = computeNextDeadline(tasks);

  updateRowById('CLIENTS', 'Client ID', clientId, {
    'Simple Completion %': simple.pct,
    'Weighted Completion %': weighted.pct,
    'Next Deadline': nextDeadline
  });

  return { simple: simple, weighted: weighted, nextDeadline: nextDeadline };
}

/** Recalculates progress for every client — the daily safety-net pass. */
function recalculateAllClientsProgress() {
  getAllRows('CLIENTS').forEach(function (c) { recalculateClientProgress(c['Client ID']); });
}
