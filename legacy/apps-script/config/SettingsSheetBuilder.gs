/**
 * Builds SETTINGS — a hybrid sheet with two independent zones:
 *   1. "Parameters" block (columns A-D, per SCHEMAS.SETTINGS): key/value
 *      system thresholds. Existing values are NEVER overwritten by a re-run —
 *      only missing default keys are appended — so admins can safely tune
 *      thresholds (architecture.md §7) without setupSpreadsheet() resetting them.
 *   2. "Enumerated lists" block (columns G+): one column per Enums.gs list,
 *      seeded only if currently empty, and always re-pointed to by a
 *      SETTINGS_<ENUM_KEY> named range so dropdowns across the system stay
 *      wired even if this sheet is rebuilt.
 */
function buildSettingsSheet() {
  var sheet = getOrCreateSheet('SETTINGS');
  removeManagedProtections(sheet);
  writeHeaderRow(sheet, 'SETTINGS');
  seedSettingsParams(sheet);
  seedSettingsEnumLists(sheet); // re-tags its own header protection internally
  protectRange(sheet, 'A1:D1', 'Settings params header');
}

function defaultSettingsParams() {
  return [
    ['HEALTH', 'HEALTH_DELAYED_TOTAL_OVERDUE_COUNT', CONST.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT, 'Client becomes Delayed once total overdue task count reaches this value.'],
    ['HEALTH', 'HEALTH_AT_RISK_OVERDUE_COUNT', CONST.HEALTH_AT_RISK_OVERDUE_COUNT, 'Client becomes At Risk once overdue task count reaches this value.'],
    ['HEALTH', 'HEALTH_AT_RISK_DUE_SOON_DAYS', CONST.HEALTH_AT_RISK_DUE_SOON_DAYS, 'Client becomes At Risk if the next deadline falls within this many days.'],
    ['REQUESTS', 'REQUEST_STALE_DAYS', CONST.REQUEST_STALE_DAYS, 'Client requests waiting this many days or more are flagged as needing attention.'],
    ['MONTHLY_CLOSE', 'MONTHLY_CLOSE_DEFAULT_DUE_DAY', CONST.MONTHLY_CLOSE_DEFAULT_DUE_DAY, 'Default day-of-month (of the month following the period) that Month-End Close tasks are due.'],
    ['WORKLOAD', 'WORKLOAD_OVERLOAD_MARGIN', CONST.WORKLOAD_OVERLOAD_MARGIN, 'Employee is flagged overloaded when open task count exceeds Capacity by more than this margin.'],
    ['SYSTEM', 'MAX_DATA_ROWS', CONST.MAX_DATA_ROWS, 'Row range used by ARRAYFORMULA/QUERY formulas system-wide. If raised here, also raise Constants.gs::MAX_DATA_ROWS and re-run setupSpreadsheet().'],
    ['SYSTEM', CONST.SAMPLE_DATA_SEEDED_KEY, 'No', 'Set to Yes automatically the first time seedSampleData() runs, to prevent duplicate sample data on re-run.']
  ];
}

function seedSettingsParams(sheet) {
  var existing = getAllRows('SETTINGS');
  var existingKeys = {};
  existing.forEach(function (row) {
    existingKeys[row['Setting Category'] + '|' + row['Setting Key']] = true;
  });

  var toAppend = defaultSettingsParams().filter(function (row) {
    return !existingKeys[row[0] + '|' + row[1]];
  });

  if (toAppend.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, 4).setValues(toAppend);
  }
}

function seedSettingsEnumLists(sheet) {
  var startCol = CONST.SETTINGS_LISTS_START_COLUMN;
  var headerRowNum = CONST.SETTINGS_LISTS_HEADER_ROW;
  var startRow = CONST.SETTINGS_LISTS_START_ROW;
  var maxRows = CONST.SETTINGS_LISTS_MAX_ROWS;
  var ss = SpreadsheetApp.getActive();

  var enumKeys = Object.keys(ENUMS).filter(function (key) { return !!ENUMS[key].values; });

  enumKeys.forEach(function (key, idx) {
    var columnIndex = startCol + idx;

    sheet.getRange(headerRowNum, columnIndex)
      .setValue(key)
      .setFontWeight('bold')
      .setBackground('#374151')
      .setFontColor('#ffffff');

    var existingRange = sheet.getRange(startRow, columnIndex, maxRows, 1).getValues();
    var hasExistingValues = existingRange.some(function (r) { return r[0] !== ''; });
    if (!hasExistingValues) {
      var seedValues = ENUMS[key].values.map(function (v) { return [v]; });
      sheet.getRange(startRow, columnIndex, seedValues.length, 1).setValues(seedValues);
    }

    var rangeName = CONST.SETTINGS_RANGE_PREFIX + key;
    var existingNamedRange = ss.getRangeByName(rangeName);
    if (existingNamedRange) ss.removeNamedRange(rangeName);
    ss.setNamedRange(rangeName, sheet.getRange(startRow, columnIndex, maxRows, 1));
  });

  var lastEnumCol = startCol + enumKeys.length - 1;
  sheet.getRange(headerRowNum, startCol, 1, enumKeys.length).setFontWeight('bold');
  if (lastEnumCol >= startCol) {
    protectRange(sheet, sheet.getRange(headerRowNum, startCol, 1, enumKeys.length).getA1Notation(), 'Settings enum list headers');
  }
}
