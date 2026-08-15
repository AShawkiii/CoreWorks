'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGasContext } = require('../helpers/loadGas');

const ctx = loadGasContext(['apps-script/tasks/WorkloadLogic.gs']);

test('isOverloaded: open task count exceeding capacity is overloaded', () => {
  assert.strictEqual(ctx.isOverloaded(6, 5, 0), true);
});

test('isOverloaded: open task count at or below capacity is not overloaded', () => {
  assert.strictEqual(ctx.isOverloaded(5, 5, 0), false);
  assert.strictEqual(ctx.isOverloaded(3, 5, 0), false);
});

test('isOverloaded: a margin raises the effective threshold', () => {
  assert.strictEqual(ctx.isOverloaded(6, 5, 2), false);
  assert.strictEqual(ctx.isOverloaded(8, 5, 2), true);
});

test('isOverloaded: an employee with no Capacity set can never be judged overloaded', () => {
  assert.strictEqual(ctx.isOverloaded(100, '', 0), false);
  assert.strictEqual(ctx.isOverloaded(100, null, 0), false);
  assert.strictEqual(ctx.isOverloaded(100, undefined, 0), false);
});

test('isOverloaded: a Capacity of exactly 0 is a real (valid) value, not treated as "unset"', () => {
  assert.strictEqual(ctx.isOverloaded(1, 0, 0), true);
  assert.strictEqual(ctx.isOverloaded(0, 0, 0), false);
});
