/**
 * Pure workload logic — no Apps Script globals, Node-testable.
 */

/** An employee with no Capacity set can't be judged overloaded (returns false rather than guessing). */
function isOverloaded(openTaskCount, capacity, margin) {
  if (!capacity && capacity !== 0) return false;
  return openTaskCount > (Number(capacity) + (margin || 0));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isOverloaded: isOverloaded };
}
