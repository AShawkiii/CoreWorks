'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

// ControlCenterViewModelLogic.gs uses isTaskOpen (TaskLogic.gs -> DateLogic.gs's
// TASK_CLOSED_STATUSES), isIssueOpen/selectSurfacedIssues (IssueLogic.gs -> ENUMS),
// and computeDaysOverdue/daysBetween (DateLogic.gs) — load the whole chain,
// matching how Apps Script merges every file into one global namespace.
const ctx = loadGasContext([
  'apps-script/config/Enums.gs',
  'apps-script/utils/DateLogic.gs',
  'apps-script/tasks/TaskLogic.gs',
  'apps-script/issues/IssueLogic.gs',
  'apps-script/webapp/ControlCenterViewModelLogic.gs'
]);

const TODAY = '2026-08-15';

function client(overrides) {
  return Object.assign({
    'Client ID': 'CL-0001', 'Client Name': 'Acme Co', 'Service Package': 'Basic Accounting',
    'Account Manager': 'Jane AM', 'Contract Status': 'Active', 'Client Health': 'On Track',
    'Weighted Completion %': 0.5, 'Next Deadline': ''
  }, overrides);
}

function task(overrides) {
  return Object.assign({
    'Client ID': 'CL-0001', 'Status': 'Not Started', 'Priority': 'Medium', 'Due Date': ''
  }, overrides);
}

function issue(overrides) {
  return Object.assign({
    'Issue ID': 'ISS-0001', 'Client ID': 'CL-0001', 'Client': 'Acme Co', 'Issue': 'Late docs',
    'Severity': 'Medium', 'Status': 'Open', 'Assigned To': 'Jane AM', 'Date Raised': '2026-08-01', 'Deadline': ''
  }, overrides);
}

// ---- buildControlCenterKpis ----

test('buildControlCenterKpis: empty data returns all-zero KPIs, no division-by-zero', () => {
  const kpis = ctx.buildControlCenterKpis([], [], [], TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.totalClients, 0);
  assert.strictEqual(byKey.activeClients, 0);
  assert.strictEqual(byKey.overallCompletionPct, 0);
  assert.strictEqual(byKey.openTasks, 0);
  assert.strictEqual(byKey.overdueTasks, 0);
  assert.strictEqual(byKey.openIssues, 0);
  assert.strictEqual(byKey.issuesNeedingAttention, 0);
});

test('buildControlCenterKpis: counts each client-status/health bucket correctly', () => {
  const clients = [
    client({ 'Client ID': 'CL-1', 'Contract Status': 'Active', 'Client Health': 'On Track' }),
    client({ 'Client ID': 'CL-2', 'Contract Status': 'Active', 'Client Health': 'At Risk' }),
    client({ 'Client ID': 'CL-3', 'Contract Status': 'Onboarding', 'Client Health': 'On Track' }),
    client({ 'Client ID': 'CL-4', 'Contract Status': 'On Hold', 'Client Health': 'On Hold' }),
    client({ 'Client ID': 'CL-5', 'Contract Status': 'Active', 'Client Health': 'Delayed' })
  ];
  const kpis = ctx.buildControlCenterKpis(clients, [], [], TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.totalClients, 5);
  assert.strictEqual(byKey.activeClients, 3);
  assert.strictEqual(byKey.onboardingClients, 1);
  assert.strictEqual(byKey.onHoldClients, 1);
  assert.strictEqual(byKey.clientsAtRisk, 1);
  assert.strictEqual(byKey.clientsDelayed, 1);
});

test('buildControlCenterKpis: task KPIs are unscoped by client Contract Status, matching the spreadsheet Control Center formulas exactly', () => {
  const tasks = [
    task({ Status: 'Not Started' }),
    task({ Status: 'In Progress' }),
    task({ Status: 'Completed' }),
    task({ Status: 'Waiting Client' }),
    task({ Status: 'Blocked' }),
    task({ Status: 'Cancelled' }), // excluded from every count
    task({ Status: 'In Progress', 'Due Date': '2020-01-01' }) // overdue
  ];
  const kpis = ctx.buildControlCenterKpis([], tasks, [], TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.openTasks, 5); // everything open except Completed and Cancelled
  assert.strictEqual(byKey.overdueTasks, 1);
  assert.strictEqual(byKey.tasksCompleted, 1);
  assert.strictEqual(byKey.waitingOnClient, 1);
  assert.strictEqual(byKey.blockedTasks, 1);
});

test('buildControlCenterKpis: overallCompletionPct averages Weighted Completion % across ALL clients (not just Active)', () => {
  const clients = [
    client({ 'Client ID': 'CL-1', 'Weighted Completion %': 0.2 }),
    client({ 'Client ID': 'CL-2', 'Weighted Completion %': 0.6, 'Contract Status': 'On Hold' })
  ];
  const kpis = ctx.buildControlCenterKpis(clients, [], [], TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.overallCompletionPct, 0.4);
});

test('buildControlCenterKpis: a client with a missing/blank Weighted Completion % counts as 0, not NaN', () => {
  const clients = [client({ 'Weighted Completion %': '' }), client({ 'Client ID': 'CL-2', 'Weighted Completion %': 0.5 })];
  const kpis = ctx.buildControlCenterKpis(clients, [], [], TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.overallCompletionPct, 0.25);
  assert.strictEqual(Number.isNaN(byKey.overallCompletionPct), false);
});

test('buildControlCenterKpis: openIssues counts every open issue; issuesNeedingAttention only the surfaced subset', () => {
  const issues = [
    issue({ Severity: 'Low', Status: 'Open' }),          // open, but not surfaced (Low/not overdue)
    issue({ Severity: 'Critical', Status: 'Open' }),      // open AND surfaced
    issue({ Severity: 'Low', Status: 'Resolved' })        // neither
  ];
  const kpis = ctx.buildControlCenterKpis([], [], issues, TODAY);
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.openIssues, 2);
  assert.strictEqual(byKey.issuesNeedingAttention, 1);
});

// ---- buildClientHealthRows ----

test('buildClientHealthRows: only Active clients are included', () => {
  const clients = [client({ 'Client ID': 'CL-1', 'Contract Status': 'Active' }), client({ 'Client ID': 'CL-2', 'Contract Status': 'On Hold' })];
  const rows = ctx.buildClientHealthRows(clients, [], [], TODAY);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].clientId, 'CL-1');
});

test('buildClientHealthRows: per-client task/issue counts are scoped correctly (no cross-client leakage)', () => {
  const clients = [client({ 'Client ID': 'CL-1' }), client({ 'Client ID': 'CL-2', 'Client Name': 'Beta Co' })];
  const tasks = [
    task({ 'Client ID': 'CL-1', Status: 'In Progress', 'Due Date': '2020-01-01' }), // overdue for CL-1
    task({ 'Client ID': 'CL-1', Status: 'Waiting Client' }),
    task({ 'Client ID': 'CL-2', Status: 'In Progress', 'Due Date': '2020-01-01' })  // overdue for CL-2
  ];
  const issues = [issue({ 'Client ID': 'CL-1', Status: 'Open' })];

  const rows = ctx.buildClientHealthRows(clients, tasks, issues, TODAY);
  const cl1 = rows.find((r) => r.clientId === 'CL-1');
  const cl2 = rows.find((r) => r.clientId === 'CL-2');

  assert.strictEqual(cl1.overdueTasks, 1);
  assert.strictEqual(cl1.waitingOnClient, 1);
  assert.strictEqual(cl1.openIssues, 1);
  assert.strictEqual(cl2.overdueTasks, 1);
  assert.strictEqual(cl2.waitingOnClient, 0);
  assert.strictEqual(cl2.openIssues, 0);
});

test('buildClientHealthRows: reads Client Health and Weighted Completion % directly rather than recomputing them', () => {
  const clients = [client({ 'Client Health': 'Delayed', 'Weighted Completion %': 0.77 })];
  const rows = ctx.buildClientHealthRows(clients, [], [], TODAY);
  assert.strictEqual(rows[0].health, 'Delayed');
  assert.strictEqual(rows[0].completionPct, 0.77);
});

test('healthSortRank: Delayed ranks 0 (highest urgency) — a "|| 99" fallback pattern would wrongly treat 0 as falsy/missing', () => {
  assert.strictEqual(ctx.healthSortRank('Delayed'), 0);
  assert.strictEqual(ctx.healthSortRank('At Risk'), 1);
  assert.strictEqual(ctx.healthSortRank('On Track'), 2);
  assert.strictEqual(ctx.healthSortRank('On Hold'), 3);
  assert.strictEqual(ctx.healthSortRank('Some Unrecognized Value'), 99);
});

test('buildClientHealthRows: sorts most-urgent health first (Delayed, At Risk, On Track, On Hold), then alphabetically', () => {
  const clients = [
    client({ 'Client ID': 'CL-1', 'Client Name': 'Zeta', 'Client Health': 'On Track' }),
    client({ 'Client ID': 'CL-2', 'Client Name': 'Alpha', 'Client Health': 'Delayed' }),
    client({ 'Client ID': 'CL-3', 'Client Name': 'Beta', 'Client Health': 'At Risk' }),
    client({ 'Client ID': 'CL-4', 'Client Name': 'Yankee', 'Client Health': 'On Track' })
  ];
  const rows = ctx.buildClientHealthRows(clients, [], [], TODAY);
  assert.deepStrictEqual(rows.map((r) => r.clientName), ['Alpha', 'Beta', 'Yankee', 'Zeta']);
});

test('buildClientHealthRows: missing optional fields (Next Deadline, Weighted Completion %) default to null/0 instead of throwing', () => {
  const clients = [client({ 'Next Deadline': '', 'Weighted Completion %': undefined })];
  const rows = ctx.buildClientHealthRows(clients, [], [], TODAY);
  assert.strictEqual(rows[0].nextDeadline, null);
  assert.strictEqual(rows[0].completionPct, 0);
});

// ---- buildSurfacedIssueRows ----

test('buildSurfacedIssueRows: reuses selectSurfacedIssues (Critical/High or overdue, unresolved only)', () => {
  const issues = [
    issue({ 'Issue ID': 'ISS-1', Severity: 'Critical', Status: 'Open' }),
    issue({ 'Issue ID': 'ISS-2', Severity: 'Low', Status: 'Open' }),      // not surfaced
    issue({ 'Issue ID': 'ISS-3', Severity: 'Low', Status: 'Resolved' })   // not surfaced
  ];
  const rows = ctx.buildSurfacedIssueRows(issues, TODAY);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].issueId, 'ISS-1');
});

test('buildSurfacedIssueRows: computes daysOpen from Date Raised, and maps owner/dueDate fields', () => {
  const issues = [issue({ Severity: 'Critical', 'Date Raised': '2026-08-01', Deadline: '2026-08-20', 'Assigned To': 'Priya' })];
  const rows = ctx.buildSurfacedIssueRows(issues, TODAY);
  assert.strictEqual(rows[0].daysOpen, 14);
  assert.strictEqual(rows[0].owner, 'Priya');
  assert.strictEqual(rows[0].dueDate, '2026-08-20');
});

test('buildSurfacedIssueRows: missing Date Raised / Deadline default to null instead of throwing', () => {
  const issues = [issue({ Severity: 'Critical', 'Date Raised': '', Deadline: '' })];
  const rows = ctx.buildSurfacedIssueRows(issues, TODAY);
  assert.strictEqual(rows[0].daysOpen, null);
  assert.strictEqual(rows[0].dueDate, null);
});

test('buildSurfacedIssueRows: an unrecognized Severity value does not throw (sorts as lowest priority)', () => {
  const issues = [issue({ Severity: 'Nonsense', Status: 'Open' })];
  assert.doesNotThrow(() => ctx.buildSurfacedIssueRows(issues, TODAY));
});

// ---- buildControlCenterViewModel (end-to-end shape) ----

test('buildControlCenterViewModel: empty data returns a well-formed, empty view model', () => {
  const vm = ctx.buildControlCenterViewModel([], [], [], TODAY);
  assert.ok(Array.isArray(vm.kpis) && vm.kpis.length > 0);
  assert.deepStrictEqual(vm.clientHealth, []);
  assert.deepStrictEqual(vm.surfacedIssues, []);
  assert.strictEqual(vm.generatedAt, TODAY);
});

test('buildControlCenterViewModel: assembles all three sections from realistic mixed data', () => {
  const clients = [client({ 'Client Health': 'At Risk' })];
  const tasks = [task({ Status: 'Blocked' })];
  const issues = [issue({ Severity: 'High', Status: 'Open' })];
  const vm = ctx.buildControlCenterViewModel(clients, tasks, issues, TODAY);

  const byKey = Object.fromEntries(vm.kpis.map((k) => [k.key, k.value]));
  assert.strictEqual(byKey.blockedTasks, 1);
  assert.strictEqual(vm.clientHealth.length, 1);
  assert.strictEqual(vm.clientHealth[0].health, 'At Risk');
  assert.strictEqual(vm.surfacedIssues.length, 1);
});
