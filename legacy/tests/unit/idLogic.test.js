'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

const ctx = loadGasContext(['apps-script/utils/IdLogic.gs']);

test('nextSequentialId: empty list starts at 1', () => {
  assert.strictEqual(ctx.nextSequentialId([], 'CL-', 4), 'CL-0001');
});

test('nextSequentialId: increments from the highest existing suffix', () => {
  assert.strictEqual(ctx.nextSequentialId(['CL-0001', 'CL-0002', 'CL-0007'], 'CL-', 4), 'CL-0008');
});

test('nextSequentialId: ignores gaps rather than filling them', () => {
  assert.strictEqual(ctx.nextSequentialId(['CL-0001', 'CL-0005'], 'CL-', 4), 'CL-0006');
});

test('nextSequentialId: ignores IDs from a different prefix', () => {
  assert.strictEqual(ctx.nextSequentialId(['EMP-001', 'CL-0003'], 'CL-', 4), 'CL-0004');
});

test('nextSequentialId: ignores malformed/non-matching IDs instead of throwing', () => {
  assert.strictEqual(ctx.nextSequentialId(['CL-0003', 'not-an-id', '', null, undefined], 'CL-', 4), 'CL-0004');
});

test('nextSequentialId: pads to the requested width and grows beyond it once the width overflows', () => {
  assert.strictEqual(ctx.nextSequentialId(['SVC-009'], 'SVC-', 3), 'SVC-010');
  assert.strictEqual(ctx.nextSequentialId(['SVC-999'], 'SVC-', 3), 'SVC-1000');
});

test('nextSequentialId: a prefix containing a regex-special character (".") is matched literally, not as a wildcard', () => {
  // If "." weren't escaped, it would also match "CLX0005" (any-character wildcard) and jump to 6.
  assert.strictEqual(ctx.nextSequentialId(['CLX0005', 'CL.0001'], 'CL.', 4), 'CL.0002');
});
