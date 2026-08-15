'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

const ctx = loadGasContext(['apps-script/utils/DateLogic.gs']);

test('computeDaysRemaining: open task with a future due date', () => {
  assert.strictEqual(ctx.computeDaysRemaining('2026-08-20', 'In Progress', '2026-08-14'), 6);
});

test('computeDaysRemaining: open task with a past due date is negative (not clamped)', () => {
  assert.strictEqual(ctx.computeDaysRemaining('2026-08-10', 'In Progress', '2026-08-14'), -4);
});

test('computeDaysRemaining: Completed task returns blank even with an overdue due date', () => {
  assert.strictEqual(ctx.computeDaysRemaining('2026-08-10', 'Completed', '2026-08-14'), '');
});

test('computeDaysRemaining: Cancelled task returns blank', () => {
  assert.strictEqual(ctx.computeDaysRemaining('2026-08-20', 'Cancelled', '2026-08-14'), '');
});

test('computeDaysRemaining: missing due date returns blank, not an error', () => {
  assert.strictEqual(ctx.computeDaysRemaining('', 'Not Started', '2026-08-14'), '');
  assert.strictEqual(ctx.computeDaysRemaining(null, 'Not Started', '2026-08-14'), '');
});

test('computeDaysOverdue: open task past due', () => {
  assert.strictEqual(ctx.computeDaysOverdue('2026-08-10', 'In Progress', '2026-08-14'), 4);
});

test('computeDaysOverdue: open task not yet due is 0, not negative', () => {
  assert.strictEqual(ctx.computeDaysOverdue('2026-08-20', 'In Progress', '2026-08-14'), 0);
});

test('computeDaysOverdue: Completed/Cancelled tasks are always 0 regardless of due date', () => {
  assert.strictEqual(ctx.computeDaysOverdue('2020-01-01', 'Completed', '2026-08-14'), 0);
  assert.strictEqual(ctx.computeDaysOverdue('2020-01-01', 'Cancelled', '2026-08-14'), 0);
});

test('computeDaysOverdue: missing due date is 0', () => {
  assert.strictEqual(ctx.computeDaysOverdue('', 'In Progress', '2026-08-14'), 0);
});

test('computeDaysWaiting: outstanding request counts from Requested Date to today', () => {
  assert.strictEqual(ctx.computeDaysWaiting('2026-08-01', 'Requested', '2026-08-14', ''), 13);
});

test('computeDaysWaiting: closed request freezes at Received Date - Requested Date', () => {
  assert.strictEqual(ctx.computeDaysWaiting('2026-08-01', 'Received', '2026-08-20', '2026-08-05'), 4);
});

test('computeDaysWaiting: closed request with no Received Date recorded returns blank', () => {
  assert.strictEqual(ctx.computeDaysWaiting('2026-08-01', 'Cancelled', '2026-08-20', ''), '');
});

test('bucketDaysWaiting: boundary values land in the correct bucket', () => {
  assert.strictEqual(ctx.bucketDaysWaiting(0), '0-3');
  assert.strictEqual(ctx.bucketDaysWaiting(3), '0-3');
  assert.strictEqual(ctx.bucketDaysWaiting(4), '4-7');
  assert.strictEqual(ctx.bucketDaysWaiting(7), '4-7');
  assert.strictEqual(ctx.bucketDaysWaiting(8), '8-14');
  assert.strictEqual(ctx.bucketDaysWaiting(14), '8-14');
  assert.strictEqual(ctx.bucketDaysWaiting(15), '15+');
  assert.strictEqual(ctx.bucketDaysWaiting(999), '15+');
});

test('bucketDaysWaiting: blank input passes through blank', () => {
  assert.strictEqual(ctx.bucketDaysWaiting(''), '');
  assert.strictEqual(ctx.bucketDaysWaiting(null), '');
});

test('frequencyHitsPeriod: Monthly/Daily/Weekly always hit', () => {
  assert.strictEqual(ctx.frequencyHitsPeriod('Monthly', '2026-08'), true);
  assert.strictEqual(ctx.frequencyHitsPeriod('Daily', '2026-08'), true);
  assert.strictEqual(ctx.frequencyHitsPeriod('Weekly', '2026-08'), true);
});

test('frequencyHitsPeriod: Quarterly only hits calendar quarter-end months', () => {
  assert.strictEqual(ctx.frequencyHitsPeriod('Quarterly', '2026-03'), true);
  assert.strictEqual(ctx.frequencyHitsPeriod('Quarterly', '2026-08'), false);
  assert.strictEqual(ctx.frequencyHitsPeriod('Quarterly', '2026-09'), true);
  assert.strictEqual(ctx.frequencyHitsPeriod('Quarterly', '2026-12'), true);
});

test('frequencyHitsPeriod: Annually only hits December', () => {
  assert.strictEqual(ctx.frequencyHitsPeriod('Annually', '2026-08'), false);
  assert.strictEqual(ctx.frequencyHitsPeriod('Annually', '2026-12'), true);
});

test('frequencyHitsPeriod: One-Time only hits the first period for that client', () => {
  assert.strictEqual(ctx.frequencyHitsPeriod('One-Time', '2026-08', true), true);
  assert.strictEqual(ctx.frequencyHitsPeriod('One-Time', '2026-09', false), false);
});

test('computeTaskDueDate: Month-End Closing is due on the configured day of the FOLLOWING month', () => {
  const due = ctx.computeTaskDueDate('2026-08', 'Month-End Closing', 3, 5);
  assert.strictEqual(due.getFullYear(), 2026);
  assert.strictEqual(due.getMonth(), 8); // 0-based September
  assert.strictEqual(due.getDate(), 5);
});

test('computeTaskDueDate: other service areas are due at period-end plus typical duration', () => {
  const due = ctx.computeTaskDueDate('2026-08', 'Bookkeeping', 2, 5);
  assert.strictEqual(due.getFullYear(), 2026);
  assert.strictEqual(due.getMonth(), 8); // September (Aug 31 + 2 days)
  assert.strictEqual(due.getDate(), 2);
});
