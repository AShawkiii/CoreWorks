/**
 * Data-validation helpers. All dropdowns are built from SETTINGS named ranges
 * (seeded by config/SettingsSheetBuilder.gs from Enums.gs), not literal
 * arrays, so business users can extend most lists directly in SETTINGS —
 * see architecture.md §5 for which values are "code-significant" and
 * therefore risky to rename even though the list itself is editable.
 */

/** Applies a dropdown to `a1Notation` on `sheet` sourced from the named range for `enumKey` (e.g. 'TASK_STATUS'). */
function applyEnumValidation(sheet, a1Notation, enumKey, allowInvalid) {
  var namedRangeName = CONST.SETTINGS_RANGE_PREFIX + enumKey;
  var namedRange = SpreadsheetApp.getActive().getRangeByName(namedRangeName);
  if (!namedRange) {
    throw new Error('applyEnumValidation(): named range "' + namedRangeName + '" not found — run buildSettingsSheet() first.');
  }
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(namedRange, true)
    .setAllowInvalid(!!allowInvalid)
    .build();
  sheet.getRange(a1Notation).setDataValidation(rule);
  return rule;
}

/** Applies a dropdown sourced directly from a literal list (only for values that are NOT in Enums.gs, e.g. a free-form catalog lookup). */
function applyListValidation(sheet, a1Notation, values, allowInvalid) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(!!allowInvalid)
    .build();
  sheet.getRange(a1Notation).setDataValidation(rule);
  return rule;
}

/** Applies a dropdown sourced from a column range on another sheet (e.g. Assigned To -> EMPLOYEES!Employee Name), so the list stays live as rows are added. */
function applyCrossSheetValidation(sheet, a1Notation, sourceSheetKey, sourceColumnName, allowInvalid) {
  var sourceSheet = getSheet(sourceSheetKey);
  var sourceCol = col(sourceSheetKey, sourceColumnName);
  var sourceRange = sourceSheet.getRange(2, sourceCol, CONST.MAX_DATA_ROWS - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sourceRange, true)
    .setAllowInvalid(!!allowInvalid)
    .build();
  sheet.getRange(a1Notation).setDataValidation(rule);
  return rule;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyEnumValidation: applyEnumValidation,
    applyListValidation: applyListValidation,
    applyCrossSheetValidation: applyCrossSheetValidation
  };
}
