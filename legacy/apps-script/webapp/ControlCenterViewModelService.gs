/**
 * IO wrapper around ControlCenterViewModelLogic.gs — the Web App's
 * google.script.run entry point for the Control Center view. Read-only:
 * reuses utils/SheetUtils.gs::getAllRows() (unmodified) against the same
 * CLIENTS/TASKS/ISSUES data the spreadsheet Control Center reads, and does
 * NOT call dashboards/ControlCenterEngine.gs (which writes cells and
 * returns nothing) — this returns a plain JSON-serializable object instead.
 *
 * JSON.parse(JSON.stringify(...)) before returning: google.script.run
 * cannot safely return raw Date objects (CLIENTS.Next Deadline, etc. come
 * back as Date from getAllRows) — this strips them down to plain
 * JSON-safe values the same way every other webapp/*ViewModelService.gs
 * function does.
 */
function getControlCenterViewModel() {
  var clients = getAllRows('CLIENTS');
  var tasks = getAllRows('TASKS');
  var issues = getAllRows('ISSUES');
  var vm = buildControlCenterViewModel(clients, tasks, issues, new Date());
  return JSON.parse(JSON.stringify(vm));
}
