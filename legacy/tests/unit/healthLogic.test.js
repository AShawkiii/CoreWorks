'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

const ctx = loadGasContext(['apps-script/clients/HealthLogic.gs']);

const THRESHOLDS = { delayedTotalOverdueCount: 3, atRiskOverdueCount: 1, atRiskDueSoonDays: 3 };

function stats(overrides) {
  return Object.assign({
    contractStatus: 'Active',
    overdueCount: 0,
    criticalOverdueCount: 0,
    openCriticalIssueCount: 0,
    openHighIssueCount: 0,
    daysToNextImportantDeadline: null
  }, overrides);
}

test('On Hold overrides every other signal', () => {
  const s = stats({ contractStatus: 'On Hold', criticalOverdueCount: 5, openCriticalIssueCount: 3 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'On Hold');
});

test('healthy client with no signals is On Track', () => {
  assert.strictEqual(ctx.computeClientHealth(stats(), THRESHOLDS), 'On Track');
});

test('a single overdue Critical task alone forces Delayed', () => {
  const s = stats({ overdueCount: 1, criticalOverdueCount: 1 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'Delayed');
});

test('overdue count below the Delayed threshold, above zero, is At Risk (not yet Delayed)', () => {
  const s = stats({ overdueCount: 2 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'At Risk');
});

test('overdue count reaching the Delayed threshold is Delayed', () => {
  const s = stats({ overdueCount: 3 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'Delayed');
});

test('a single non-critical overdue task is At Risk at the default threshold', () => {
  const s = stats({ overdueCount: 1 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'At Risk');
});

test('an open Critical issue forces Delayed even with zero overdue tasks', () => {
  const s = stats({ openCriticalIssueCount: 1 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'Delayed');
});

test('an open High issue is At Risk (not Delayed)', () => {
  const s = stats({ openHighIssueCount: 1 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'At Risk');
});

test('an important (Critical/High) deadline due within the threshold is At Risk', () => {
  const s = stats({ daysToNextImportantDeadline: 2 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'At Risk');
});

test('an important deadline exactly at the threshold boundary is At Risk', () => {
  const s = stats({ daysToNextImportantDeadline: 3 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'At Risk');
});

test('an important deadline just beyond the threshold is On Track', () => {
  const s = stats({ daysToNextImportantDeadline: 4 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'On Track');
});

test('a negative daysToNextImportantDeadline (already overdue) does not itself trigger the due-soon rule (overdueCount is the correct signal for that)', () => {
  const s = stats({ daysToNextImportantDeadline: -1 });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'On Track');
});

test('null daysToNextImportantDeadline (no open Critical/High task) never triggers due-soon', () => {
  const s = stats({ daysToNextImportantDeadline: null });
  assert.strictEqual(ctx.computeClientHealth(s, THRESHOLDS), 'On Track');
});

test('thresholds are configurable: a stricter atRiskOverdueCount changes the outcome', () => {
  const strict = { delayedTotalOverdueCount: 3, atRiskOverdueCount: 5, atRiskDueSoonDays: 3 };
  const s = stats({ overdueCount: 1 });
  assert.strictEqual(ctx.computeClientHealth(s, strict), 'On Track');
});
