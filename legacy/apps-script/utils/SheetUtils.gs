/**
 * Generic Sheets I/O helpers used across every *Service.gs / *Engine.gs file.
 * These wrap SpreadsheetApp so nothing else has to touch it directly, and
 * every read/write goes through SCHEMAS/col() so column order changes only
 * ever need to happen in Schemas.gs.
 */

/** Returns the Sheet object for a data-sheet key (throws if missing). */
function getSheet(sheetKey) {
  var name = SHEETS[sheetKey];
  if (!name) throw new Error('getSheet(): unknown sheet key "' + sheetKey + '"');
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('getSheet(): sheet "' + name + '" does not exist yet — run setupSpreadsheet() first.');
  return sheet;
}

/** Gets or creates a sheet by key, without assuming it already exists. */
function getOrCreateSheet(sheetKey) {
  var name = SHEETS[sheetKey];
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

/**
 * Reads every populated data row of a data-sheet as an array of plain objects
 * keyed by header name (via SCHEMAS). Skips fully-blank rows (blank ID cell).
 */
function getAllRows(sheetKey) {
  var sheet = getSheet(sheetKey);
  var headers = headerRow(sheetKey);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue; // blank ID => blank row
    var obj = { __row: i + 2 }; // 1-based sheet row, for later updateRowById calls
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[i][c];
    }
    rows.push(obj);
  }
  return rows;
}

/** Appends one row, built from a partial object keyed by header name. Missing keys become ''. */
function appendRow(sheetKey, rowObject) {
  var sheet = getSheet(sheetKey);
  var headers = headerRow(sheetKey);
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(rowObject, h) ? rowObject[h] : '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** Appends many rows at once (single write) — used by bulk generators. */
function appendRows(sheetKey, rowObjects) {
  if (!rowObjects.length) return;
  var sheet = getSheet(sheetKey);
  var headers = headerRow(sheetKey);
  var rows = rowObjects.map(function (rowObject) {
    return headers.map(function (h) {
      return Object.prototype.hasOwnProperty.call(rowObject, h) ? rowObject[h] : '';
    });
  });
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
}

/** Returns the 1-based sheet row number for the row whose idColumnName cell equals id, or -1. */
function findRowIndexById(sheetKey, idColumnName, id) {
  var sheet = getSheet(sheetKey);
  var idCol = col(sheetKey, idColumnName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

/** Patches specific columns of the row matching id (by idColumnName) with values from patchObject. */
function updateRowById(sheetKey, idColumnName, id, patchObject) {
  var sheetRow = findRowIndexById(sheetKey, idColumnName, id);
  if (sheetRow === -1) throw new Error('updateRowById(): no row found on "' + sheetKey + '" where ' + idColumnName + ' = ' + id);
  var sheet = getSheet(sheetKey);
  Object.keys(patchObject).forEach(function (columnName) {
    sheet.getRange(sheetRow, col(sheetKey, columnName)).setValue(patchObject[columnName]);
  });
  return sheetRow;
}

/** Writes the standard bold/dark header row for a data sheet and freezes it. Safe to re-run (never touches rows below). */
function writeHeaderRow(sheet, sheetKey) {
  var headers = headerRow(sheetKey);
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  if (sheet.getMaxColumns() > headers.length) {
    sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  }
  sheet.autoResizeColumns(1, headers.length);
}

/** Converts a 1-based column index to its A1 letter (e.g. 1 -> 'A', 27 -> 'AA'). */
function columnIndexToLetter(columnIndex) {
  var letter = '';
  var n = columnIndex;
  while (n > 0) {
    var remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** Builds an A1 "Col2:Col(maxRows+1)" data-row range string (row 2 through maxRows+1) for a schema column. */
function rangeFor(sheetKey, columnName, maxRows) {
  var columnLetter = columnIndexToLetter(col(sheetKey, columnName));
  return columnLetter + '2:' + columnLetter + (maxRows + 1);
}

/** Reads a single SETTINGS parameter value by category+key; returns fallback if not found. */
function getSetting(category, key, fallback) {
  var rows = getAllRows('SETTINGS');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['Setting Category'] === category && rows[i]['Setting Key'] === key) {
      return rows[i]['Value'];
    }
  }
  return fallback;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getSheet: getSheet,
    getOrCreateSheet: getOrCreateSheet,
    getAllRows: getAllRows,
    appendRow: appendRow,
    appendRows: appendRows,
    findRowIndexById: findRowIndexById,
    updateRowById: updateRowById,
    getSetting: getSetting,
    columnIndexToLetter: columnIndexToLetter,
    rangeFor: rangeFor,
    writeHeaderRow: writeHeaderRow
  };
}
