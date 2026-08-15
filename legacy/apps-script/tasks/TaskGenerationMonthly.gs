/**
 * Phase 7's recurring monthly task automation. Safe to re-run for the same
 * period (never duplicates), and never touches a prior period's tasks
 * (history is preserved — architecture.md §7). Bound to a monthly
 * time-driven trigger in Stage 7 via runMonthlyTaskGeneration().
 */

/**
 * Generates this (or an explicitly given) period's recurring tasks for every
 * Active client. `targetPeriod` defaults to the current "YYYY-MM" — pass one
 * explicitly to back-fill a missed month.
 */
function generateMonthlyTasks(targetPeriod) {
  var period = targetPeriod || formatPeriod(new Date());
  var monthlyCloseDueDay = Number(getSetting('MONTHLY_CLOSE', 'MONTHLY_CLOSE_DEFAULT_DUE_DAY', CONST.MONTHLY_CLOSE_DEFAULT_DUE_DAY));

  var clients = getAllRows('CLIENTS').filter(function (c) { return c['Contract Status'] === 'Active'; });
  var employees = getAllRows('EMPLOYEES');
  var allTasks = getAllRows('TASKS');

  var existingKeys = {};
  var clientsWithAnyTask = {};
  allTasks.forEach(function (t) {
    existingKeys[taskDedupeKey(t['Client ID'], t['Service Area'], t['Task Name'], t['Period'])] = true;
    clientsWithAnyTask[t['Client ID']] = true;
  });

  var tasksCreated = 0;

  clients.forEach(function (client) {
    var templates = getActiveTemplatesForPackage(client['Service Package']);
    var isFirstPeriodForClient = !clientsWithAnyTask[client['Client ID']];

    templates.forEach(function (template) {
      if (!frequencyHitsPeriod(template['Frequency'], period, isFirstPeriodForClient)) return;

      var key = taskDedupeKey(client['Client ID'], template['Service Area'], template['Task Name'], period);
      if (existingKeys[key]) return;

      var dueDate = computeTaskDueDate(period, template['Service Area'], Number(template['Typical Duration (Days)']), monthlyCloseDueDay);
      var assigneeName = resolveDefaultAssignee(template['Default Assignee'], client, employees);
      var expanded = expandTemplateToTask(template, client, period, dueDate, assigneeName, 'Recurring');

      createTask(expanded, { skipLog: true });
      existingKeys[key] = true;
      tasksCreated++;
    });
  });

  logActivity('Monthly Tasks Generated', 'System', period, '', tasksCreated + ' tasks for ' + clients.length + ' active clients', '');

  return { period: period, clientsProcessed: clients.length, tasksCreated: tasksCreated };
}

/** Entry point for the monthly time-driven trigger (automation/Triggers.gs, Stage 7). */
function runMonthlyTaskGeneration() {
  return generateMonthlyTasks();
}
