/**
 * The single append path for ACTIVITY_LOG (Phase 16). Every *Service.gs /
 * *Engine.gs file in this system calls logActivity() for a semantic event
 * (task created/completed/reassigned, status changed, client added, request
 * created, issue created/resolved, monthly generation run) — never for a
 * pure recalculation write, per the "skip trivial logging" rule.
 *
 * Also stamps CLIENTS.Last Activity for the affected client, since that
 * column's definition (architecture.md §6) is "most recent ACTIVITY_LOG
 * timestamp for the client" — this is the one place that's true, so it's
 * the one place that writes it.
 */
function logActivity(action, entityType, entityId, previousValue, newValue, client, comment) {
  var activity = {
    'Activity ID': generateNextId('ACTIVITY_LOG'),
    'Date': new Date(),
    'User': currentUserEmail(),
    'Client': client || '',
    'Entity Type': entityType,
    'Entity ID': entityId,
    'Action': action,
    'Previous Value': previousValue || '',
    'New Value': newValue || '',
    'Comment': comment || ''
  };

  appendRow('ACTIVITY_LOG', activity);

  if (client) {
    touchClientLastActivity(client, activity['Date']);
  }

  return activity;
}

/** Session.getEffectiveUser() returns a User object in real Apps Script (needs .getEmail()); tolerates a plain string too (e.g. a test harness). */
function currentUserEmail() {
  var user = Session.getEffectiveUser();
  if (user && typeof user.getEmail === 'function') return user.getEmail();
  return String(user || '');
}

function touchClientLastActivity(clientName, date) {
  var client = getAllRows('CLIENTS').filter(function (c) { return c['Client Name'] === clientName; })[0];
  if (!client) return;
  updateRowById('CLIENTS', 'Client ID', client['Client ID'], { 'Last Activity': date });
}
