/**
 * Pure progress calculation — no Apps Script globals, Node-testable.
 * Phase 8: Simple Completion % (count-based) and Weighted Completion %
 * (priority-weighted), both computed the same way — over every non-Cancelled
 * task for a client — so they're always comparable.
 */

function computeSimpleCompletion(tasks) {
  var counted = tasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });
  var completed = counted.filter(function (t) { return t['Status'] === 'Completed'; }).length;
  var total = counted.length;
  return { completed: completed, total: total, pct: total === 0 ? 0 : completed / total };
}

/** `weights` is ENUMS.PRIORITY.weights (Critical=4/High=3/Medium=2/Low=1); an unrecognized/missing priority weighs 1. */
function computeWeightedCompletion(tasks, weights) {
  var counted = tasks.filter(function (t) { return t['Status'] !== 'Cancelled'; });
  var totalWeight = 0;
  var completedWeight = 0;
  counted.forEach(function (t) {
    var w = (weights && weights[t['Priority']]) || 1;
    totalWeight += w;
    if (t['Status'] === 'Completed') completedWeight += w;
  });
  return { completedWeight: completedWeight, totalWeight: totalWeight, pct: totalWeight === 0 ? 0 : completedWeight / totalWeight };
}

/** Earliest Due Date among a client's still-open tasks, or '' if none have one. Used for CLIENTS.Next Deadline. */
function computeNextDeadline(tasks) {
  var candidates = tasks.filter(function (t) { return isTaskOpen(t['Status']) && t['Due Date']; });
  if (!candidates.length) return '';
  return candidates.reduce(function (earliest, t) {
    var due = new Date(t['Due Date']);
    return (!earliest || due < earliest) ? due : earliest;
  }, null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeSimpleCompletion: computeSimpleCompletion,
    computeWeightedCompletion: computeWeightedCompletion,
    computeNextDeadline: computeNextDeadline
  };
}
