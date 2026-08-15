/**
 * Pure task business logic — no Apps Script globals, Node-testable.
 * Day-math (Days Remaining/Overdue) lives in utils/DateLogic.gs, which this
 * file does not duplicate; TaskLogic.gs owns validation and the status state
 * machine instead.
 */

/** Statuses a task may move to FROM each status. Same-status "no-op" transitions are always allowed by nextStatusAllowed. Cancelled is terminal. */
var TASK_STATUS_TRANSITIONS = {
  'Not Started': ['In Progress', 'Cancelled'],
  'In Progress': ['Waiting Client', 'Blocked', 'In Review', 'Completed', 'Cancelled'],
  'Waiting Client': ['In Progress', 'Blocked', 'Cancelled'],
  'Blocked': ['In Progress', 'Waiting Client', 'Cancelled'],
  'In Review': ['In Progress', 'Completed', 'Cancelled'],
  'Completed': ['In Progress'], // reopening for a correction is allowed; nothing else is
  'Cancelled': [] // terminal — a cancelled task is never resumed, create a new one instead
};

function isTaskOpen(status) {
  return TASK_CLOSED_STATUSES.indexOf(status) === -1;
}

/** Whether a transition from `current` to `target` status is allowed. Same-status is always a no-op allow. */
function nextStatusAllowed(current, target) {
  if (current === target) return true;
  var allowed = TASK_STATUS_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.indexOf(target) !== -1;
}

/**
 * Validates the minimum required fields for a new task. Returns
 * { valid: boolean, errors: string[] }. Does not touch any sheet — the
 * caller (tasks/TaskService.gs) is responsible for cross-referencing that
 * Client ID / Assigned To actually exist.
 */
function validateTaskFields(task) {
  var errors = [];
  if (!task['Client ID']) errors.push('Client ID is required.');
  if (!task['Task Name']) errors.push('Task Name is required.');
  if (!task['Service Area']) errors.push('Service Area is required.');
  if (task['Priority'] && ENUMS.PRIORITY.values.indexOf(task['Priority']) === -1) {
    errors.push('Priority "' + task['Priority'] + '" is not a recognized value.');
  }
  if (task['Status'] && ENUMS.TASK_STATUS.values.indexOf(task['Status']) === -1) {
    errors.push('Status "' + task['Status'] + '" is not a recognized value.');
  }
  return { valid: errors.length === 0, errors: errors };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TASK_STATUS_TRANSITIONS: TASK_STATUS_TRANSITIONS,
    isTaskOpen: isTaskOpen,
    nextStatusAllowed: nextStatusAllowed,
    validateTaskFields: validateTaskFields
  };
}
