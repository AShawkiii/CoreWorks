/**
 * Pure template -> task expansion — no Apps Script globals, Node-testable.
 * The ONE place that turns a TASK_TEMPLATES row into TASKS fields, shared by
 * tasks/TaskGenerationOnboarding.gs and tasks/TaskGenerationMonthly.gs so
 * onboarding-generated and monthly-generated tasks are never built by two
 * different rules (architecture.md §7).
 *
 * Does not assign a Task ID or stamp Created Date/Last Updated — the caller
 * passes the returned object straight into tasks/TaskService.gs::createTask,
 * which owns those (architecture.md §8 layering).
 */
function expandTemplateToTask(template, client, period, dueDate, assigneeName, taskCategory) {
  return {
    'Client ID': client['Client ID'],
    'Client Name': client['Client Name'],
    'Service Area': template['Service Area'],
    'Task Category': taskCategory,
    'Task Name': template['Task Name'],
    'Description': template['Description'],
    'Period': period,
    'Frequency': template['Frequency'],
    'Assigned To': assigneeName,
    'Priority': template['Priority'],
    'Status': 'Not Started',
    'Start Date': '',
    'Due Date': dueDate,
    'Completion Date': '',
    'Waiting For': '',
    'Client Dependency': template['Required Client Input?'] === 'Yes' ? 'Yes' : 'No',
    'Completion %': 0,
    'Reviewer': '',
    'Review Status': 'Not Reviewed',
    'Notes': ''
  };
}

/**
 * Builds a duplicate-detection key for a would-be generated task, used by
 * the onboarding/monthly generators to skip a (Client, Service Area, Task
 * Name, Period) combination that already exists in TASKS — this is what
 * makes generateMonthlyTasks() safe to re-run and what preserves history
 * across months (architecture.md §7).
 */
function taskDedupeKey(clientId, serviceArea, taskName, period) {
  return clientId + '|' + serviceArea + '|' + taskName + '|' + period;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { expandTemplateToTask: expandTemplateToTask, taskDedupeKey: taskDedupeKey };
}
