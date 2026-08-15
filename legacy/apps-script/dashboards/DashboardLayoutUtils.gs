/**
 * Small layout helpers shared by every layout-only dashboard sheet builder
 * (ControlCenter, ClientDashboard, TeamDashboard, MonthlyCloseDashboard).
 */

/** Writes a bold, shaded section-title cell spanning column A of `rowIndex`. */
function writeSectionHeader(sheet, rowIndex, label) {
  sheet.getRange(rowIndex, 1).setValue(label)
    .setFontWeight('bold').setFontSize(12).setBackground('#e5e7eb');
}

/** Writes a bold, dark table header row starting at column A of `rowIndex`. */
function writeTableHeaders(sheet, rowIndex, headers) {
  var range = sheet.getRange(rowIndex, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
}

/**
 * Clears a fixed-size report window starting at column A of `startRow` then
 * writes `rows` into it. Rows beyond `maxRows` are dropped rather than
 * silently truncated without a floor — every dashboard section that uses
 * this caps its window generously (see each sheet's *_LAYOUT constant) and
 * is documented as a top-N view, not a complete listing.
 */
function writeReportTableRows(sheet, startRow, numCols, maxRows, rows) {
  sheet.getRange(startRow, 1, maxRows, numCols).clearContent();
  var toWrite = rows.slice(0, maxRows);
  if (toWrite.length) sheet.getRange(startRow, 1, toWrite.length, numCols).setValues(toWrite);
}
