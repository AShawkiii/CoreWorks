/**
 * ACTIVITY_LOG — append-only audit trail (architecture.md §10). Entirely
 * script-written via automation/ActivityLogger.gs; the whole data area is
 * protected so it can't be hand-edited from the UI (the script itself still
 * writes fine, since Apps Script always executes as the owner).
 */
function buildActivityLogSheet() {
  var sheet = getOrCreateSheet('ACTIVITY_LOG');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'ACTIVITY_LOG');

  var maxRows = CONST.MAX_DATA_ROWS;
  applyEnumValidation(sheet, rangeFor('ACTIVITY_LOG', 'Entity Type', maxRows), 'ENTITY_TYPE', false);

  protectSheetExcept(sheet, 'Activity log append-only', []);
}
