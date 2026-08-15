/**
 * In-sheet navigation links (Phase 18), placed on row 1 of the 4 layout-only
 * dashboard sheets, well to the right of their title text so they never
 * collide with any dashboard content. The custom "Finance Lab" menu
 * (automation/Menu.gs) is the primary navigation surface and covers every
 * sheet including the 11 data tables; these in-sheet links are a shortcut
 * for the dashboards specifically, where users naturally land first.
 */
var NAV_ITEMS = [
  { label: 'Control Center', sheetKey: 'CONTROL_CENTER' },
  { label: 'Clients', sheetKey: 'CLIENTS' },
  { label: 'Tasks', sheetKey: 'TASKS' },
  { label: 'Monthly Close', sheetKey: 'MONTHLY_CLOSE' },
  { label: 'Client Requests', sheetKey: 'CLIENT_REQUESTS' },
  { label: 'Issues', sheetKey: 'ISSUES' },
  { label: 'Team Dashboard', sheetKey: 'TEAM_DASHBOARD' },
  { label: 'Client Dashboard', sheetKey: 'CLIENT_DASHBOARD' },
  { label: 'Settings', sheetKey: 'SETTINGS' }
];

var NAV_ROW_START_COLUMN = 12; // column L — clear of every dashboard's title/content in columns A-K

function installNavigationRows() {
  ['CONTROL_CENTER', 'CLIENT_DASHBOARD', 'TEAM_DASHBOARD', 'MONTHLY_CLOSE_DASHBOARD'].forEach(function (sheetKey) {
    buildNavRow(getSheet(sheetKey));
  });
}

function buildNavRow(sheet) {
  NAV_ITEMS.forEach(function (item, i) {
    var targetSheet = getSheet(item.sheetKey);
    var formula = '=HYPERLINK("#gid=' + targetSheet.getSheetId() + '", "' + item.label + '")';
    sheet.getRange(1, NAV_ROW_START_COLUMN + i).setFormula(formula).setFontColor('#1155cc').setFontSize(9);
  });
}
