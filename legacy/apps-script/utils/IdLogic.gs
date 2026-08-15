/**
 * Pure ID-generation logic — no Apps Script globals, Node-testable.
 * Sequential, prefixed, zero-padded IDs (architecture.md §4). The composite
 * Monthly Close ID (MC-<ClientID>-<YYYYMM>) is NOT sequential and is built
 * directly by tasks/MonthlyCloseService.gs instead of through this file.
 */

/**
 * Given the full list of existing IDs for an entity (e.g. all Client IDs
 * already in CLIENTS), a prefix (e.g. "CL-"), and the numeric zero-pad width
 * (e.g. 4 for "0007"), returns the next sequential ID.
 *
 * Ignores IDs that don't match the expected "<prefix><digits>" shape (so a
 * stray malformed row can't corrupt numbering), and starts at 1 if none exist.
 */
function nextSequentialId(existingIds, prefix, padWidth) {
  var pattern = new RegExp('^' + escapeRegExp(prefix) + '(\\d+)$');
  var maxSuffix = 0;

  for (var i = 0; i < existingIds.length; i++) {
    var id = existingIds[i];
    if (typeof id !== 'string') continue;
    var match = id.match(pattern);
    if (!match) continue;
    var suffix = parseInt(match[1], 10);
    if (suffix > maxSuffix) maxSuffix = suffix;
  }

  var next = maxSuffix + 1;
  var padded = String(next);
  while (padded.length < padWidth) padded = '0' + padded;
  return prefix + padded;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nextSequentialId: nextSequentialId, escapeRegExp: escapeRegExp };
}
