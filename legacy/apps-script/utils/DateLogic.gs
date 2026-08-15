/**
 * Pure date/period logic — no Apps Script globals, Node-testable.
 * Mirrors the live ARRAYFORMULA logic on TASKS/CLIENT_REQUESTS exactly, so
 * script-side recalculation (e.g. sample data seeding, dashboards) and the
 * sheet formulas never disagree.
 */

var TASK_CLOSED_STATUSES = ['Completed', 'Cancelled'];
var REQUEST_CLOSED_STATUSES = ['Received', 'Not Available', 'Cancelled'];

/** Strips time-of-day so date subtraction always yields whole days. */
function toDateOnly(date) {
  var d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole-day difference: dateA - dateB, in days (positive if dateA is later). */
function daysBetween(dateA, dateB) {
  var msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toDateOnly(dateA).getTime() - toDateOnly(dateB).getTime()) / msPerDay);
}

/**
 * Mirrors TASKS!Days Remaining. Returns '' if the task is closed or has no
 * due date, otherwise Due Date - today (can be negative once overdue).
 */
function computeDaysRemaining(dueDate, status, today) {
  if (!dueDate) return '';
  if (TASK_CLOSED_STATUSES.indexOf(status) !== -1) return '';
  return daysBetween(dueDate, today);
}

/**
 * Mirrors TASKS!Days Overdue. Returns 0 unless the task is open, has a due
 * date, and that due date has passed — then returns today - Due Date (a
 * positive number of days overdue).
 */
function computeDaysOverdue(dueDate, status, today) {
  if (!dueDate) return 0;
  if (TASK_CLOSED_STATUSES.indexOf(status) !== -1) return 0;
  var diff = daysBetween(today, dueDate);
  return diff > 0 ? diff : 0;
}

/**
 * Mirrors CLIENT_REQUESTS!Days Waiting. While outstanding, counts from
 * Requested Date to today; once closed, freezes at Requested Date -> Received
 * Date (falls back to today if closed with no Received Date recorded).
 */
function computeDaysWaiting(requestedDate, status, today, receivedDate) {
  if (!requestedDate) return '';
  if (REQUEST_CLOSED_STATUSES.indexOf(status) !== -1) {
    return receivedDate ? daysBetween(receivedDate, requestedDate) : '';
  }
  return daysBetween(today, requestedDate);
}

/** Mirrors CLIENT_REQUESTS!Days Waiting Bucket. '' passes through (e.g. closed with no Received Date). */
function bucketDaysWaiting(days) {
  if (days === '' || days === null || typeof days === 'undefined') return '';
  if (days <= 3) return '0-3';
  if (days <= 7) return '4-7';
  if (days <= 14) return '8-14';
  return '15+';
}

/**
 * Whether a template's Frequency "hits" for the given "YYYY-MM" period, i.e.
 * whether generateMonthlyTasks() should produce a task for it this period.
 * Daily/Weekly/Monthly templates fire every period (V1 represents them as one
 * recurring monthly checklist item, not literal daily/weekly rows). Quarterly
 * fires on calendar quarter-end months (Mar/Jun/Sep/Dec). Annually fires on
 * December. One-Time fires only for isFirstPeriodForClient.
 */
function frequencyHitsPeriod(frequency, period, isFirstPeriodForClient) {
  if (frequency === 'One-Time') return !!isFirstPeriodForClient;
  var month = parseInt(String(period).split('-')[1], 10);
  if (frequency === 'Quarterly') return [3, 6, 9, 12].indexOf(month) !== -1;
  if (frequency === 'Annually') return month === 12;
  // Daily, Weekly, Monthly
  return true;
}

/**
 * Computes a generated task's Due Date for a given "YYYY-MM" period.
 * PROFESSIONAL ASSUMPTION (documented per the master prompt's instruction to
 * flag non-architectural judgment calls, since the spec doesn't state an
 * exact due-date rule): Month-End Closing tasks are due on
 * `monthlyCloseDueDay` of the month FOLLOWING the period (sourced from
 * SETTINGS -> MONTHLY_CLOSE.MONTHLY_CLOSE_DEFAULT_DUE_DAY); every other
 * recurring task is due on the last calendar day of the period's own month,
 * plus its template's Typical Duration (Days) as a completion buffer.
 */
function computeTaskDueDate(period, serviceArea, typicalDurationDays, monthlyCloseDueDay) {
  var parts = String(period).split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10); // 1-based (1 = January)

  if (serviceArea === 'Month-End Closing') {
    return new Date(year, month, monthlyCloseDueDay || 5);
  }

  var lastDayOfPeriodMonth = new Date(year, month, 0); // day 0 of 1-based `month` = last day of that month
  var due = new Date(lastDayOfPeriodMonth.getTime());
  due.setDate(due.getDate() + (typicalDurationDays || 0));
  return due;
}

/** Returns "YYYY-MM" for a given date (defaults to today via caller-passed date). */
function formatPeriod(date) {
  var d = new Date(date);
  var month = String(d.getMonth() + 1);
  if (month.length < 2) month = '0' + month;
  return d.getFullYear() + '-' + month;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toDateOnly: toDateOnly,
    daysBetween: daysBetween,
    computeDaysRemaining: computeDaysRemaining,
    computeDaysOverdue: computeDaysOverdue,
    computeDaysWaiting: computeDaysWaiting,
    bucketDaysWaiting: bucketDaysWaiting,
    frequencyHitsPeriod: frequencyHitsPeriod,
    computeTaskDueDate: computeTaskDueDate,
    formatPeriod: formatPeriod,
    TASK_CLOSED_STATUSES: TASK_CLOSED_STATUSES,
    REQUEST_CLOSED_STATUSES: REQUEST_CLOSED_STATUSES
  };
}
