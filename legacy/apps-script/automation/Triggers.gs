/**
 * Event handlers and trigger installation (Phase 18 supporting automation).
 * installTimeDrivenTriggers() is appended to config/Setup.gs's
 * setupSpreadsheet() — see the comment there.
 */

/** Simple menu on every open — see automation/Menu.gs::buildCustomMenu(). */
function onOpen() {
  buildCustomMenu();
}

/**
 * Installable onEdit handler — routes edits that matter:
 *  - TASKS.Status changed by hand -> validate the transition, log it,
 *    recalc that client's progress/health.
 *  - CLIENT_DASHBOARD's client picker changed -> re-render.
 *  - MONTHLY_CLOSE_DASHBOARD's client/month filters changed -> re-render.
 * Everything else is a no-op; this must stay cheap since it runs on every
 * keystroke-committing edit across the whole spreadsheet.
 */
function onEditHandler(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();

  if (sheetName === SHEETS.TASKS && e.range.getColumn() === col('TASKS', 'Status') && e.range.getNumRows() === 1) {
    handleTaskStatusEdit(e);
  } else if (sheetName === SHEETS.CLIENT_DASHBOARD && e.range.getA1Notation() === CD_LAYOUT.SELECTOR_VALUE_CELL) {
    renderClientDashboard();
  } else if (sheetName === SHEETS.MONTHLY_CLOSE_DASHBOARD &&
      (e.range.getA1Notation() === MCD_LAYOUT.CLIENT_FILTER_VALUE_CELL || e.range.getA1Notation() === MCD_LAYOUT.MONTH_FILTER_VALUE_CELL)) {
    renderMonthlyCloseDashboard();
  }
}

/**
 * A manual TASKS.Status edit can't go through tasks/TaskService.gs::
 * updateTaskStatus() the normal way — by the time onEdit fires, the sheet
 * already shows the NEW value, so "previous status" only exists on the edit
 * event (e.oldValue), not in the sheet. An invalid transition is reverted
 * in place with a toast rather than silently accepted.
 */
function handleTaskStatusEdit(e) {
  var row = e.range.getRow();
  var sheet = e.range.getSheet();
  var taskId = sheet.getRange(row, col('TASKS', 'Task ID')).getValue();
  if (!taskId) return;

  var newStatus = e.range.getValue();
  var previousStatus = e.oldValue || '';

  if (previousStatus && !nextStatusAllowed(previousStatus, newStatus)) {
    e.range.setValue(previousStatus);
    SpreadsheetApp.getActive().toast('"' + previousStatus + '" -> "' + newStatus + '" is not an allowed status transition.', 'Finance Lab', 6);
    return;
  }

  var now = new Date();
  sheet.getRange(row, col('TASKS', 'Last Updated')).setValue(now);
  if (newStatus === 'Completed') {
    sheet.getRange(row, col('TASKS', 'Completion Date')).setValue(now);
    sheet.getRange(row, col('TASKS', 'Completion %')).setValue(1);
  } else if (previousStatus === 'Completed') {
    sheet.getRange(row, col('TASKS', 'Completion Date')).setValue('');
  }

  var clientId = sheet.getRange(row, col('TASKS', 'Client ID')).getValue();
  var clientName = sheet.getRange(row, col('TASKS', 'Client Name')).getValue();

  if (previousStatus !== newStatus) {
    logActivity('Task Status Changed', 'Task', taskId, previousStatus, newStatus, clientName);
  }
  if (clientId) {
    recalculateClientProgress(clientId);
    recalculateClientHealth(clientId);
  }
}

/** Daily safety-net recalculation — catches anything a specific-edit trigger might have missed (e.g. a Due Date rolling into "overdue" with no edit at all). */
function dailyRecalculation() {
  recalculateAllClientsProgress();
  recalculateAllClientsHealth();
  renderControlCenter();
  renderTeamDashboard();
}

var MANAGED_TRIGGER_HANDLERS = ['dailyRecalculation', 'runMonthlyTaskGeneration', 'generateMonthlyManagementReport', 'onEditHandler'];

function installTimeDrivenTriggers() {
  removeManagedTriggers();

  ScriptApp.newTrigger('dailyRecalculation').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('runMonthlyTaskGeneration').timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger('generateMonthlyManagementReport').timeBased().onMonthDay(1).atHour(4).create();
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

function removeManagedTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (MANAGED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}
