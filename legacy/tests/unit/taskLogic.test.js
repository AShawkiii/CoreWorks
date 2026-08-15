'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

// TaskLogic.gs references ENUMS (Enums.gs) and TASK_CLOSED_STATUSES (DateLogic.gs).
const ctx = loadGasContext([
  'apps-script/config/Enums.gs',
  'apps-script/utils/DateLogic.gs',
  'apps-script/tasks/TaskLogic.gs'
]);

test('nextStatusAllowed: same-status is always a no-op allow', () => {
  assert.strictEqual(ctx.nextStatusAllowed('In Progress', 'In Progress'), true);
  assert.strictEqual(ctx.nextStatusAllowed('Cancelled', 'Cancelled'), true);
});

test('nextStatusAllowed: the normal forward path is allowed', () => {
  assert.strictEqual(ctx.nextStatusAllowed('Not Started', 'In Progress'), true);
  assert.strictEqual(ctx.nextStatusAllowed('In Progress', 'In Review'), true);
  assert.strictEqual(ctx.nextStatusAllowed('In Review', 'Completed'), true);
});

test('nextStatusAllowed: any open status can be Cancelled', () => {
  ['Not Started', 'In Progress', 'Waiting Client', 'Blocked', 'In Review'].forEach((status) => {
    assert.strictEqual(ctx.nextStatusAllowed(status, 'Cancelled'), true, status + ' -> Cancelled should be allowed');
  });
});

test('nextStatusAllowed: Cancelled is terminal — nothing resumes a cancelled task', () => {
  ['Not Started', 'In Progress', 'Waiting Client', 'Blocked', 'In Review', 'Completed'].forEach((status) => {
    assert.strictEqual(ctx.nextStatusAllowed('Cancelled', status), false, 'Cancelled -> ' + status + ' should be rejected');
  });
});

test('nextStatusAllowed: Completed can only reopen to In Progress, nothing else', () => {
  assert.strictEqual(ctx.nextStatusAllowed('Completed', 'In Progress'), true);
  assert.strictEqual(ctx.nextStatusAllowed('Completed', 'Blocked'), false);
  assert.strictEqual(ctx.nextStatusAllowed('Completed', 'Waiting Client'), false);
  assert.strictEqual(ctx.nextStatusAllowed('Completed', 'Not Started'), false);
});

test('nextStatusAllowed: Not Started cannot jump straight to Completed (must move through In Progress/In Review)', () => {
  assert.strictEqual(ctx.nextStatusAllowed('Not Started', 'Completed'), false);
});

test('isTaskOpen: Completed and Cancelled are closed, everything else is open', () => {
  assert.strictEqual(ctx.isTaskOpen('Completed'), false);
  assert.strictEqual(ctx.isTaskOpen('Cancelled'), false);
  assert.strictEqual(ctx.isTaskOpen('Not Started'), true);
  assert.strictEqual(ctx.isTaskOpen('Blocked'), true);
});

test('validateTaskFields: rejects a task missing required fields, with a specific message per field', () => {
  const result = ctx.validateTaskFields({});
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors.length, 3);
});

test('validateTaskFields: accepts a minimally complete task', () => {
  const result = ctx.validateTaskFields({ 'Client ID': 'CL-0001', 'Task Name': 'Bank Rec', 'Service Area': 'Bank Reconciliation' });
  assert.strictEqual(result.valid, true);
  assert.deepEqual(result.errors, []); // deepEqual (not deepStrictEqual): result.errors is a vm-realm Array, see progressLogic.test.js's note
});

test('validateTaskFields: rejects an unrecognized Priority or Status value', () => {
  const badPriority = ctx.validateTaskFields({ 'Client ID': 'CL-0001', 'Task Name': 'X', 'Service Area': 'Y', Priority: 'Urgent!!' });
  assert.strictEqual(badPriority.valid, false);

  const badStatus = ctx.validateTaskFields({ 'Client ID': 'CL-0001', 'Task Name': 'X', 'Service Area': 'Y', Status: 'Kinda Done' });
  assert.strictEqual(badStatus.valid, false);
});
