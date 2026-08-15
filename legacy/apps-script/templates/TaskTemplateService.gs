/**
 * IO wrapper for TASK_TEMPLATES — seeds the catalog content from
 * TaskTemplatesData.gs and serves it to the onboarding/monthly generators.
 */

/** Idempotent: only appends templates not already present (matched by Service Package + Task Name). */
function seedTaskTemplates() {
  var existing = getAllRows('TASK_TEMPLATES');
  var existingKeys = {};
  existing.forEach(function (r) { existingKeys[r['Service Package'] + '|' + r['Task Name']] = true; });
  var existingIds = existing.map(function (r) { return r['Template ID']; });

  var rowsToAppend = [];
  buildTaskTemplateSeed().forEach(function (t) {
    var key = t.servicePackage + '|' + t.taskName;
    if (existingKeys[key]) return;
    var id = nextSequentialId(existingIds, 'TPL-', 3);
    existingIds.push(id);
    rowsToAppend.push({
      'Template ID': id,
      'Service Package': t.servicePackage,
      'Service Area': t.serviceArea,
      'Task Name': t.taskName,
      'Description': t.description,
      'Frequency': t.frequency,
      'Priority': t.priority,
      'Default Assignee': t.role,
      'Typical Duration (Days)': t.durationDays,
      'Required Client Input?': t.requiresClientInput,
      'Active?': 'Yes'
    });
  });

  if (rowsToAppend.length) appendRows('TASK_TEMPLATES', rowsToAppend);
  return rowsToAppend.length;
}

/** Returns all active templates for a given Service Package name. */
function getActiveTemplatesForPackage(packageName) {
  return getAllRows('TASK_TEMPLATES').filter(function (t) {
    return t['Service Package'] === packageName && t['Active?'] === 'Yes';
  });
}
