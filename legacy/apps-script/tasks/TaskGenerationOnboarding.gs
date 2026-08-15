/**
 * Phase 6's onboarding task generation — expands every active template for
 * a client's Service Package into a TASKS row for the current period.
 * Duplicate-safe (keyed the same way as the monthly generator) so calling
 * this twice for the same client never creates a second copy of a task.
 *
 * Due dates use the SAME rule as the monthly generator
 * (utils/DateLogic.gs::computeTaskDueDate — period-end + typical duration,
 * or the following month for Month-End Closing) rather than "today + typical
 * duration". A brand-new client's first recurring deliverables are due on
 * the normal monthly cadence like any other client's, not in 1-3 days —
 * generating them with a same-day due date produced unrealistically tight
 * deadlines and made every fresh client look "At Risk" immediately.
 */
function generateOnboardingTasks(clientId, servicePackage) {
  var client = getAllRows('CLIENTS').filter(function (c) { return c['Client ID'] === clientId; })[0];
  if (!client) throw new Error('generateOnboardingTasks(): no client found with ID ' + clientId);

  var templates = getActiveTemplatesForPackage(servicePackage);
  var employees = getAllRows('EMPLOYEES');
  var existingTasks = getTasksForClient(clientId);
  var existingKeys = {};
  existingTasks.forEach(function (t) {
    existingKeys[taskDedupeKey(t['Client ID'], t['Service Area'], t['Task Name'], t['Period'])] = true;
  });

  var today = new Date();
  var period = formatPeriod(today);
  var monthlyCloseDueDay = Number(getSetting('MONTHLY_CLOSE', 'MONTHLY_CLOSE_DEFAULT_DUE_DAY', CONST.MONTHLY_CLOSE_DEFAULT_DUE_DAY));
  var tasksCreated = 0;

  templates.forEach(function (template) {
    var key = taskDedupeKey(clientId, template['Service Area'], template['Task Name'], period);
    if (existingKeys[key]) return;

    var dueDate = computeTaskDueDate(period, template['Service Area'], Number(template['Typical Duration (Days)']), monthlyCloseDueDay);
    var assigneeName = resolveDefaultAssignee(template['Default Assignee'], client, employees);
    var expanded = expandTemplateToTask(template, client, period, dueDate, assigneeName, 'Onboarding');

    createTask(expanded, { skipLog: true });
    existingKeys[key] = true;
    tasksCreated++;
  });

  if (tasksCreated > 0) {
    logActivity('Onboarding Tasks Generated', 'Client', clientId, '', tasksCreated + ' tasks created', client['Client Name']);
  }

  return { clientId: clientId, tasksCreated: tasksCreated };
}
