'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

// computeNextDeadline uses isTaskOpen (TaskLogic.gs), which itself uses
// TASK_CLOSED_STATUSES (DateLogic.gs) — load the whole chain, matching how
// Apps Script merges every file into one global namespace at runtime.
// Note: objects/arrays returned from ctx.* calls live in the vm sandbox's
// realm, so assert.deepStrictEqual (which checks prototype identity) would
// spuriously fail against this file's own object/array literals even when
// structurally identical — use assert.deepEqual (structural only) instead
// wherever comparing a full ctx.* return value.
const ctx = loadGasContext([
  'apps-script/config/Enums.gs',
  'apps-script/utils/DateLogic.gs',
  'apps-script/tasks/TaskLogic.gs',
  'apps-script/tasks/ProgressLogic.gs'
]);

function task(overrides) {
  return Object.assign({ Status: 'Not Started', Priority: 'Medium', 'Due Date': '' }, overrides);
}

test('computeSimpleCompletion: zero tasks is 0% without dividing by zero', () => {
  const result = ctx.computeSimpleCompletion([]);
  assert.deepEqual(result, { completed: 0, total: 0, pct: 0 });
});

test('computeSimpleCompletion: all-Cancelled tasks are excluded from both completed and total', () => {
  const tasks = [task({ Status: 'Cancelled' }), task({ Status: 'Cancelled' })];
  const result = ctx.computeSimpleCompletion(tasks);
  assert.deepEqual(result, { completed: 0, total: 0, pct: 0 });
});

test('computeSimpleCompletion: mixed statuses, Cancelled excluded from the denominator', () => {
  const tasks = [task({ Status: 'Completed' }), task({ Status: 'In Progress' }), task({ Status: 'Cancelled' })];
  const result = ctx.computeSimpleCompletion(tasks);
  assert.strictEqual(result.completed, 1);
  assert.strictEqual(result.total, 2);
  assert.strictEqual(result.pct, 0.5);
});

test('computeWeightedCompletion: zero tasks is 0% without dividing by zero', () => {
  const weights = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  assert.deepEqual(ctx.computeWeightedCompletion([], weights), { completedWeight: 0, totalWeight: 0, pct: 0 });
});

test('computeWeightedCompletion: Critical tasks count 4x a Low task (Phase 8 weighting)', () => {
  const weights = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const tasks = [
    task({ Status: 'Completed', Priority: 'Critical' }),
    task({ Status: 'Not Started', Priority: 'Low' })
  ];
  const result = ctx.computeWeightedCompletion(tasks, weights);
  assert.strictEqual(result.completedWeight, 4);
  assert.strictEqual(result.totalWeight, 5);
  assert.strictEqual(result.pct, 4 / 5);
});

test('computeWeightedCompletion: an unrecognized/missing priority weighs 1', () => {
  const weights = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const tasks = [task({ Status: 'Completed', Priority: 'Unknown' })];
  const result = ctx.computeWeightedCompletion(tasks, weights);
  assert.strictEqual(result.totalWeight, 1);
  assert.strictEqual(result.completedWeight, 1);
});

test('computeNextDeadline: zero tasks returns blank', () => {
  assert.strictEqual(ctx.computeNextDeadline([]), '');
});

test('computeNextDeadline: only closed tasks (Completed/Cancelled) returns blank', () => {
  const tasks = [task({ Status: 'Completed', 'Due Date': '2026-08-01' }), task({ Status: 'Cancelled', 'Due Date': '2026-08-02' })];
  assert.strictEqual(ctx.computeNextDeadline(tasks), '');
});

test('computeNextDeadline: picks the earliest due date among open tasks, ignoring closed ones and ones with no due date', () => {
  const tasks = [
    task({ Status: 'Not Started', 'Due Date': '2026-09-15' }),
    task({ Status: 'Not Started', 'Due Date': '2026-08-20' }),
    task({ Status: 'Completed', 'Due Date': '2026-01-01' }),
    task({ Status: 'In Progress', 'Due Date': '' })
  ];
  const next = ctx.computeNextDeadline(tasks);
  assert.strictEqual(next.getFullYear(), 2026);
  assert.strictEqual(next.getMonth(), 7); // August, 0-based
  assert.strictEqual(next.getDate(), 20);
});
