/**
 * IO wrapper around TaskLogic.gs — the only path that creates or transitions
 * TASKS rows, so ID generation, default fields, and activity logging happen
 * in exactly one place regardless of whether a task came from onboarding,
 * monthly generation, or manual entry.
 */

/**
 * Creates a task from a partial fields object (as produced by
 * templates/TemplateExpansionLogic.gs::expandTemplateToTask, or built by
 * hand for a manual/ad-hoc task). Defaults Status to 'Not Started',
 * Completion % to 0, Review Status to 'Not Reviewed', and stamps Created
 * Date / Last Updated. Throws if validateTaskFields() rejects the input.
 *
 * Pass options.skipLog = true from bulk generators (onboarding/monthly) —
 * they log ONE summary activity for the whole run instead of one per task
 * (Phase 16's "skip trivial/repetitive logging" rule); manual/ad-hoc
 * creation via this function directly still logs individually.
 */
function createTask(fields, options) {
  var task = Object.assign({}, fields);
  task['Status'] = task['Status'] || 'Not Started';
  task['Completion %'] = typeof task['Completion %'] === 'number' ? task['Completion %'] : 0;
  task['Review Status'] = task['Review Status'] || 'Not Reviewed';
  task['Task Category'] = task['Task Category'] || 'Ad-Hoc';

  var validation = validateTaskFields(task);
  if (!validation.valid) {
    throw new Error('createTask(): invalid task fields — ' + validation.errors.join(' '));
  }

  var now = new Date();
  task['Task ID'] = generateNextId('TASKS');
  task['Created Date'] = now;
  task['Last Updated'] = now;

  appendRow('TASKS', task);
  if (!options || !options.skipLog) {
    logActivity('Task Created', 'Task', task['Task ID'], '', task['Task Name'], task['Client Name'] || '');
  }
  return task;
}

/**
 * Transitions a task's Status, enforcing TaskLogic's state machine. Sets
 * Completion Date when moving to Completed, clears it when reopened.
 * No-ops (still touches Last Updated) if newStatus equals the current one.
 */
function updateTaskStatus(taskId, newStatus) {
  var rows = getAllRows('TASKS');
  var task = rows.filter(function (t) { return t['Task ID'] === taskId; })[0];
  if (!task) throw new Error('updateTaskStatus(): no task found with ID ' + taskId);

  var currentStatus = task['Status'];
  if (!nextStatusAllowed(currentStatus, newStatus)) {
    throw new Error('updateTaskStatus(): "' + currentStatus + '" -> "' + newStatus + '" is not an allowed transition.');
  }

  var patch = { 'Status': newStatus, 'Last Updated': new Date() };
  if (newStatus === 'Completed') {
    patch['Completion Date'] = new Date();
    patch['Completion %'] = 1;
  } else if (currentStatus === 'Completed' && newStatus !== 'Completed') {
    patch['Completion Date'] = '';
  }

  updateRowById('TASKS', 'Task ID', taskId, patch);

  if (currentStatus !== newStatus) {
    logActivity('Task Status Changed', 'Task', taskId, currentStatus, newStatus, task['Client Name'] || '');
  }
  return patch;
}

/** Reassigns a task to a different employee, logging the change. */
function reassignTask(taskId, newAssignee) {
  var rows = getAllRows('TASKS');
  var task = rows.filter(function (t) { return t['Task ID'] === taskId; })[0];
  if (!task) throw new Error('reassignTask(): no task found with ID ' + taskId);

  var previousAssignee = task['Assigned To'];
  updateRowById('TASKS', 'Task ID', taskId, { 'Assigned To': newAssignee, 'Last Updated': new Date() });

  if (previousAssignee !== newAssignee) {
    logActivity('Task Reassigned', 'Task', taskId, previousAssignee, newAssignee, task['Client Name'] || '');
  }
}

function getTasksForClient(clientId) {
  return getAllRows('TASKS').filter(function (t) { return t['Client ID'] === clientId; });
}

function getOpenTasksForEmployee(employeeName) {
  return getAllRows('TASKS').filter(function (t) {
    return t['Assigned To'] === employeeName && isTaskOpen(t['Status']);
  });
}
