/**
 * Pure client business logic — no Apps Script globals, Node-testable.
 */

function validateClientFields(client) {
  var errors = [];
  if (!client['Client Name']) errors.push('Client Name is required.');
  if (!client['Service Package']) errors.push('Service Package is required.');
  if (!client['Account Manager']) errors.push('Account Manager is required.');
  if (!client['Start Date']) errors.push('Start Date is required.');
  return { valid: errors.length === 0, errors: errors };
}

/** Two clients are considered duplicates if both Client Name and Company Name match an existing row. */
function isDuplicateClient(newClient, existingClients) {
  return existingClients.some(function (c) {
    return c['Client Name'] === newClient['Client Name'] && c['Company Name'] === newClient['Company Name'];
  });
}

/**
 * Resolves a template's role-based Default Assignee to an actual employee
 * name for a specific client (architecture.md §7 / TASK_TEMPLATES builder
 * note). Prefers the client's own Account Manager when their role matches;
 * otherwise the first active employee with that role; otherwise falls back
 * to the Account Manager regardless of role, so a task is never left
 * unassigned.
 */
function resolveDefaultAssignee(role, client, employees) {
  var accountManagerName = client['Account Manager'];
  var accountManager = employees.filter(function (e) { return e['Employee Name'] === accountManagerName; })[0];
  if (accountManager && accountManager['Role'] === role) return accountManagerName;

  var roleMatch = employees.filter(function (e) { return e['Role'] === role && e['Active?'] === 'Yes'; })[0];
  if (roleMatch) return roleMatch['Employee Name'];

  return accountManagerName || '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateClientFields: validateClientFields,
    isDuplicateClient: isDuplicateClient,
    resolveDefaultAssignee: resolveDefaultAssignee
  };
}
