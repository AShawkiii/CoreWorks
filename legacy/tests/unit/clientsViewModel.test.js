'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

// ClientsViewModelLogic.gs reuses isTaskOpen/computeDaysRemaining (DateLogic/
// TaskLogic), isIssueOpen (IssueLogic), isRequestOpen (ClientRequestLogic),
// and healthSortRank (ControlCenterViewModelLogic, same webapp/ global
// namespace) — load the whole chain, matching how Apps Script merges every
// file into one global namespace.
const ctx = loadGasContext([
  'apps-script/config/Enums.gs',
  'apps-script/utils/DateLogic.gs',
  'apps-script/tasks/TaskLogic.gs',
  'apps-script/issues/IssueLogic.gs',
  'apps-script/requests/ClientRequestLogic.gs',
  'apps-script/webapp/ControlCenterViewModelLogic.gs',
  'apps-script/webapp/ClientsViewModelLogic.gs'
]);

const TODAY = '2026-08-15';

function client(overrides) {
  return Object.assign({
    'Client ID': 'CL-0001', 'Client Name': 'Acme Co', 'Company Name': 'Acme LLC',
    'Industry': 'Retail', 'Business Type': 'LLC', 'Service Package': 'Basic Accounting',
    'Account Manager': 'Jane AM', 'Backup Team Member': '', 'Client Contact': 'Bob',
    'Email': 'bob@acme.example', 'Phone': '555-0100', 'Contract Status': 'Active',
    'Priority': 'Medium', 'Client Health': 'On Track', 'Simple Completion %': 0.4,
    'Weighted Completion %': 0.5, 'Last Activity': '', 'Next Deadline': '', 'Notes': ''
  }, overrides);
}

function task(overrides) {
  return Object.assign({
    'Task ID': 'TSK-000001', 'Client ID': 'CL-0001', 'Task Name': 'Bank Rec', 'Service Area': 'Bank Reconciliation',
    'Status': 'Not Started', 'Priority': 'Medium', 'Assigned To': 'Priya', 'Due Date': '', 'Review Status': 'Not Reviewed'
  }, overrides);
}

function issue(overrides) {
  return Object.assign({
    'Issue ID': 'ISS-0001', 'Client ID': 'CL-0001', 'Issue': 'Late docs', 'Category': 'Communication',
    'Severity': 'Medium', 'Status': 'Open', 'Assigned To': 'Jane', 'Date Raised': '2026-08-01', 'Deadline': '',
    'Required Action': 'Follow up'
  }, overrides);
}

function request(overrides) {
  return Object.assign({
    'Request ID': 'REQ-0001', 'Client ID': 'CL-0001', 'Request': 'Send statements', 'Status': 'Requested',
    'Requested Date': '2026-08-01', 'Required By': '', 'Days Waiting': 14, 'Days Waiting Bucket': '8-14', 'Assigned To': 'Jane'
  }, overrides);
}

// ---- buildClientsListViewModel ----

test('buildClientsListViewModel: empty clients returns empty list', () => {
  assert.deepStrictEqual(ctx.buildClientsListViewModel([]), []);
});

test('buildClientsListViewModel: maps every required field', () => {
  const rows = ctx.buildClientsListViewModel([client({
    'Client ID': 'CL-9', 'Client Name': 'Nimbus', 'Service Package': 'CFO / FP&A', 'Account Manager': 'Grace',
    'Contract Status': 'Active', 'Client Health': 'Delayed', 'Weighted Completion %': 0.33, 'Next Deadline': '2026-09-01'
  })]);
  // deepEqual (not deepStrictEqual): rows[0] is a vm-realm object — see
  // progressLogic.test.js's note on why deepStrictEqual spuriously fails here.
  assert.deepEqual(rows[0], {
    clientId: 'CL-9', clientName: 'Nimbus', servicePackage: 'CFO / FP&A', accountManager: 'Grace',
    contractStatus: 'Active', health: 'Delayed', completionPct: 0.33, nextDeadline: '2026-09-01'
  });
});

test('buildClientsListViewModel: includes clients of every Contract Status (not just Active)', () => {
  const clients = [
    client({ 'Client ID': 'CL-1', 'Contract Status': 'Active' }),
    client({ 'Client ID': 'CL-2', 'Contract Status': 'On Hold' }),
    client({ 'Client ID': 'CL-3', 'Contract Status': 'Onboarding' })
  ];
  const rows = ctx.buildClientsListViewModel(clients);
  assert.strictEqual(rows.length, 3);
});

test('buildClientsListViewModel: default-sorts most-urgent health first, then alphabetically', () => {
  const clients = [
    client({ 'Client ID': 'CL-1', 'Client Name': 'Zeta', 'Client Health': 'On Track' }),
    client({ 'Client ID': 'CL-2', 'Client Name': 'Alpha', 'Client Health': 'Delayed' }),
    client({ 'Client ID': 'CL-3', 'Client Name': 'Beta', 'Client Health': 'At Risk' })
  ];
  const rows = ctx.buildClientsListViewModel(clients);
  assert.deepStrictEqual(rows.map((r) => r.clientName), ['Alpha', 'Beta', 'Zeta']);
});

test('buildClientsListViewModel: missing Weighted Completion % / Next Deadline default to 0 / null', () => {
  const rows = ctx.buildClientsListViewModel([client({ 'Weighted Completion %': '', 'Next Deadline': '' })]);
  assert.strictEqual(rows[0].completionPct, 0);
  assert.strictEqual(rows[0].nextDeadline, null);
});

// ---- buildClientDetailViewModel ----

test('buildClientDetailViewModel: returns null for an unknown clientId (not a throw)', () => {
  assert.strictEqual(ctx.buildClientDetailViewModel('CL-999', [], [], [], [], TODAY), null);
});

test('buildClientDetailViewModel: maps client info fields directly (reads Health/Completion %, does not recompute)', () => {
  const clients = [client({ 'Client Health': 'At Risk', 'Simple Completion %': 0.6, 'Weighted Completion %': 0.7 })];
  const vm = ctx.buildClientDetailViewModel('CL-0001', clients, [], [], [], TODAY);
  assert.strictEqual(vm.health, 'At Risk');
  assert.strictEqual(vm.simpleCompletionPct, 0.6);
  assert.strictEqual(vm.weightedCompletionPct, 0.7);
  assert.strictEqual(vm.clientName, 'Acme Co');
  assert.strictEqual(vm.accountManager, 'Jane AM');
});

test('buildClientDetailViewModel: scopes tasks/issues/requests to this client only, excluding other clients\' rows', () => {
  const clients = [client({ 'Client ID': 'CL-1' }), client({ 'Client ID': 'CL-2', 'Client Name': 'Beta Co' })];
  const tasks = [task({ 'Client ID': 'CL-1' }), task({ 'Client ID': 'CL-2', 'Task ID': 'TSK-2' })];
  const issues = [issue({ 'Client ID': 'CL-1' }), issue({ 'Client ID': 'CL-2', 'Issue ID': 'ISS-2' })];
  const requests = [request({ 'Client ID': 'CL-1' }), request({ 'Client ID': 'CL-2', 'Request ID': 'REQ-2' })];

  const vm = ctx.buildClientDetailViewModel('CL-1', clients, tasks, issues, requests, TODAY);
  assert.strictEqual(vm.tasks.length, 1);
  assert.strictEqual(vm.issues.length, 1);
  assert.strictEqual(vm.requests.length, 1);
  assert.strictEqual(vm.tasks[0].taskId, 'TSK-000001');
});

test('buildClientDetailViewModel: only OPEN tasks/issues/requests are included (Completed/Resolved/Received excluded)', () => {
  const clients = [client()];
  const tasks = [task({ 'Task ID': 'TSK-1', Status: 'Not Started' }), task({ 'Task ID': 'TSK-2', Status: 'Completed' })];
  const issues = [issue({ 'Issue ID': 'ISS-1', Status: 'Open' }), issue({ 'Issue ID': 'ISS-2', Status: 'Resolved' })];
  const requests = [request({ 'Request ID': 'REQ-1', Status: 'Requested' }), request({ 'Request ID': 'REQ-2', Status: 'Received' })];

  const vm = ctx.buildClientDetailViewModel('CL-0001', clients, tasks, issues, requests, TODAY);
  assert.deepStrictEqual(vm.tasks.map((t) => t.taskId), ['TSK-1']);
  assert.deepStrictEqual(vm.issues.map((i) => i.issueId), ['ISS-1']);
  assert.deepStrictEqual(vm.requests.map((r) => r.requestId), ['REQ-1']);
});

test('buildClientDetailViewModel: missing optional fields (Last Activity, Next Deadline, Notes) default cleanly', () => {
  const clients = [client({ 'Last Activity': '', 'Next Deadline': '', Notes: '' })];
  const vm = ctx.buildClientDetailViewModel('CL-0001', clients, [], [], [], TODAY);
  assert.strictEqual(vm.lastActivity, null);
  assert.strictEqual(vm.nextDeadline, null);
  assert.strictEqual(vm.notes, '');
});

// ---- buildClientDetailTaskRows ----

test('buildClientDetailTaskRows: sorts by soonest due date first; tasks with no due date sort last', () => {
  const tasks = [
    task({ 'Task ID': 'A', 'Due Date': '' }),
    task({ 'Task ID': 'B', 'Due Date': '2026-09-01' }),
    task({ 'Task ID': 'C', 'Due Date': '2026-08-20' })
  ];
  const rows = ctx.buildClientDetailTaskRows(tasks, TODAY);
  assert.deepStrictEqual(rows.map((r) => r.taskId), ['C', 'B', 'A']);
});

test('buildClientDetailTaskRows: computes daysRemaining via the shared DateLogic function', () => {
  const rows = ctx.buildClientDetailTaskRows([task({ 'Due Date': '2026-08-20', Status: 'In Progress' })], TODAY);
  assert.strictEqual(rows[0].daysRemaining, 5);
});

// ---- buildClientDetailIssueRows ----

test('buildClientDetailIssueRows: sorts most severe first (Critical > High > Medium > Low)', () => {
  const issues = [
    issue({ 'Issue ID': 'A', Severity: 'Low' }),
    issue({ 'Issue ID': 'B', Severity: 'Critical' }),
    issue({ 'Issue ID': 'C', Severity: 'Medium' })
  ];
  const rows = ctx.buildClientDetailIssueRows(issues);
  assert.deepStrictEqual(rows.map((r) => r.issueId), ['B', 'C', 'A']);
});

test('buildClientDetailIssueRows: an unrecognized Severity value does not throw (sorts as lowest)', () => {
  assert.doesNotThrow(() => ctx.buildClientDetailIssueRows([issue({ Severity: 'Nonsense' })]));
});

// ---- buildClientDetailRequestRows ----

test('buildClientDetailRequestRows: sorts longest-waiting first', () => {
  const requests = [
    request({ 'Request ID': 'A', 'Days Waiting': 3 }),
    request({ 'Request ID': 'B', 'Days Waiting': 20 }),
    request({ 'Request ID': 'C', 'Days Waiting': 10 })
  ];
  const rows = ctx.buildClientDetailRequestRows(requests);
  assert.deepStrictEqual(rows.map((r) => r.requestId), ['B', 'C', 'A']);
});

test('buildClientDetailRequestRows: reads Days Waiting / Days Waiting Bucket directly rather than recomputing them', () => {
  const rows = ctx.buildClientDetailRequestRows([request({ 'Days Waiting': 16, 'Days Waiting Bucket': '15+' })]);
  assert.strictEqual(rows[0].daysWaiting, 16);
  assert.strictEqual(rows[0].daysWaitingBucket, '15+');
});

test('buildClientDetailRequestRows: a blank Days Waiting (e.g. closed request with no Received Date) becomes null, not NaN or an error', () => {
  const rows = ctx.buildClientDetailRequestRows([request({ 'Days Waiting': '' })]);
  assert.strictEqual(rows[0].daysWaiting, null);
});
