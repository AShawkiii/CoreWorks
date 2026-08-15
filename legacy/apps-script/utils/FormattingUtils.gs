/**
 * Conditional formatting helpers. Google Sheets conditional format rules have
 * no description/tag field (unlike protections), so idempotency here means:
 * every *SheetBuilder.gs that owns a sheet's formatting calls
 * resetConditionalFormatting() with its FULL desired rule set each time,
 * rather than trying to add/remove individual rules.
 */

/** Replaces every conditional format rule on `sheet` with exactly `rules` (an array of Rule builders already built via .build()). */
function resetConditionalFormatting(sheet, rules) {
  sheet.clearConditionalFormatRules();
  sheet.setConditionalFormatRules(rules);
}

/** Builds one "text is exactly" background-color rule per value in an enum's `colors` map, applied to `a1Notation`. */
function buildEnumColorRules(sheet, a1Notation, enumKey) {
  var colors = ENUMS[enumKey] && ENUMS[enumKey].colors;
  if (!colors) return [];
  var range = sheet.getRange(a1Notation);
  return Object.keys(colors).map(function (value) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value)
      .setBackground(colors[value])
      .setRanges([range])
      .build();
  });
}

/** Builds a single rule that highlights `a1Notation` red when the numeric cell value is greater than `threshold` (e.g. Days Overdue > 0). */
function buildOverdueHighlightRule(sheet, a1Notation, threshold) {
  var range = sheet.getRange(a1Notation);
  return SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(threshold)
    .setBackground('#f8d7da')
    .setFontColor('#842029')
    .setRanges([range])
    .build();
}

/** Builds one "text is exactly" rule per bucket value in DAYS_WAITING_BUCKET, escalating color, applied to `a1Notation`. */
function buildStaleRequestRules(sheet, a1Notation) {
  var range = sheet.getRange(a1Notation);
  var colors = { '0-3': '#d4edda', '4-7': '#fff3cd', '8-14': '#ffe0b2', '15+': '#f8d7da' };
  return ENUMS.DAYS_WAITING_BUCKET.values.map(function (bucket) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(bucket)
      .setBackground(colors[bucket])
      .setRanges([range])
      .build();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resetConditionalFormatting: resetConditionalFormatting,
    buildEnumColorRules: buildEnumColorRules,
    buildOverdueHighlightRule: buildOverdueHighlightRule,
    buildStaleRequestRules: buildStaleRequestRules
  };
}
