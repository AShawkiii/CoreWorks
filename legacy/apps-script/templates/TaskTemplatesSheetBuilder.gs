/**
 * TASK_TEMPLATES — headers, dropdowns, and formatting only. The actual
 * template catalog content (Basic Accounting / Full Finance / CFO-FP&A) is
 * seeded by templates/TaskTemplateService.gs in Stage 3, once
 * TemplateExpansionLogic exists to consume it.
 *
 * "Default Assignee" stores a ROLE (validated against EMPLOYEES!Role), not a
 * named person — a template is shared across all clients on a package, so it
 * can't hardcode one employee. clients/ClientLogic.gs resolves a role to an
 * actual employee per client at generation time (Stage 4).
 */
function buildTaskTemplatesSheet() {
  var sheet = getOrCreateSheet('TASK_TEMPLATES');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'TASK_TEMPLATES');

  var maxRows = CONST.MAX_DATA_ROWS;

  applyCrossSheetValidation(sheet, rangeFor('TASK_TEMPLATES', 'Service Package', maxRows), 'SERVICE_PACKAGES', 'Package Name', false);
  applyCrossSheetValidation(sheet, rangeFor('TASK_TEMPLATES', 'Default Assignee', maxRows), 'EMPLOYEES', 'Role', true);
  applyEnumValidation(sheet, rangeFor('TASK_TEMPLATES', 'Frequency', maxRows), 'FREQUENCY', false);
  applyEnumValidation(sheet, rangeFor('TASK_TEMPLATES', 'Priority', maxRows), 'PRIORITY', false);
  applyEnumValidation(sheet, rangeFor('TASK_TEMPLATES', 'Required Client Input?', maxRows), 'ACTIVE_FLAG', false);
  applyEnumValidation(sheet, rangeFor('TASK_TEMPLATES', 'Active?', maxRows), 'ACTIVE_FLAG', false);

  resetConditionalFormatting(sheet, []
    .concat(buildEnumColorRules(sheet, rangeFor('TASK_TEMPLATES', 'Priority', maxRows), 'PRIORITY'))
    .concat(buildEnumColorRules(sheet, rangeFor('TASK_TEMPLATES', 'Active?', maxRows), 'ACTIVE_FLAG'))
  );
}
