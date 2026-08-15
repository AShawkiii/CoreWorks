/**
 * Workload rules.
 *
 * Port of legacy `apps-script/tasks/WorkloadLogic.gs` (audit §6.7).
 */

/**
 * Legacy `isOverloaded`.
 *
 * A member with no capacity set can never be judged overloaded — legacy
 * returns false rather than guessing a default, because an invented ceiling
 * would flag people the firm never rated.
 *
 * A capacity of exactly 0 is a REAL value meaning "any open task is too
 * many", not "unset". Legacy has a dedicated test for that distinction, and
 * a `!capacity` check would collapse the two.
 */
export function isOverloaded(
  openTaskCount: number,
  capacity: number | null,
  margin = 0,
): boolean {
  if (capacity === null || capacity === undefined) return false;
  return openTaskCount > capacity + margin;
}
