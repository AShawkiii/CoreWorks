/**
 * Sheet-protection helpers used to lock script-computed columns (Days
 * Remaining/Overdue, Completion %, Client Health, etc.) against manual edits,
 * while keeping setupSpreadsheet() idempotent: every protection this system
 * creates is tagged with a description starting with CONST.MANAGED_TAG_PREFIX,
 * so a re-run removes-then-recreates instead of duplicating.
 *
 * Note: Apps Script always executes as the project owner/authorizing user and
 * bypasses its own sheet protections, so these protect end users from
 * accidental manual edits in the UI — they do not (and cannot) block the
 * script itself, which is the intended behavior for computed columns.
 */

/** Removes every protection on `sheet` previously created by this system. */
function removeManagedProtections(sheet) {
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .concat(sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET));
  protections.forEach(function (p) {
    var description = '';
    try { description = p.getDescription() || ''; } catch (e) { /* some protections lack a description */ }
    if (description.indexOf(CONST.MANAGED_TAG_PREFIX) === 0) {
      p.remove();
    }
  });
}

/**
 * Protects an A1 range on `sheet` with a managed-tagged description. Warning
 * only (no explicit editor list) unless `editors` is provided, so the default
 * behavior is "editable only by the file's editors who dismiss the warning"
 * is NOT what we want — instead we set removeEditors to lock it down for
 * everyone except the owner when `editors` is omitted.
 */
function protectRange(sheet, a1Notation, label, editors) {
  var range = sheet.getRange(a1Notation);
  var protection = range.protect().setDescription(CONST.MANAGED_TAG_PREFIX + label);
  var me = Session.getEffectiveUser();
  try {
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (e) { /* some protection types don't support editor lists (e.g. sheet-level with warning only) */ }
  if (editors && editors.length) {
    protection.addEditors(editors);
  }
  if (me && protection.getEditors().indexOf(me) === -1) {
    protection.addEditor(me);
  }
  return protection;
}

/** Protects the entire sheet except for the ranges listed in `unprotectedA1Ranges` (e.g. free-text input columns). */
function protectSheetExcept(sheet, label, unprotectedA1Ranges) {
  var protection = sheet.protect().setDescription(CONST.MANAGED_TAG_PREFIX + label);
  if (unprotectedA1Ranges && unprotectedA1Ranges.length) {
    var ranges = unprotectedA1Ranges.map(function (a1) { return sheet.getRange(a1); });
    protection.setUnprotectedRanges(ranges);
  }
  var me = Session.getEffectiveUser();
  try { protection.removeEditors(protection.getEditors()); } catch (e) { /* ignore */ }
  if (me) protection.addEditor(me);
  return protection;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { removeManagedProtections: removeManagedProtections, protectRange: protectRange, protectSheetExcept: protectSheetExcept };
}
