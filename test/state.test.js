const test = require('node:test');
const assert = require('node:assert/strict');
const { accountKey, acquireLease, scanCheckpoint, publishScan } = require('../src/state.js');

test('cache keys are scoped to the numeric profile id', () => {
  assert.notEqual(accountKey(12), accountKey(13));
  assert.throws(() => accountKey('not-an-id'));
});

test('a live lease excludes another worker and an expired lease can be reclaimed', () => {
  const live = acquireLease(null, 'a', 1000, 500);
  assert.equal(acquireLease(live, 'b', 1200, 500), null);
  assert.equal(acquireLease(live, 'b', 1600, 500).owner, 'b');
});

test('checkpointing a partial scan never marks it complete', () => {
  const state = scanCheckpoint(null, { page: 5, ratings: { 1: {} } }, 100);
  assert.equal(state.scan.complete, false);
  assert.equal(state.scan.nextPage, 6);
});

test('only a completed full scan replaces prior ratings', () => {
  const old = { ratings: { 1: { seriesId: 1 }, 2: { seriesId: 2 } } };
  const incremental = publishScan(old, { ratings: { 1: { seriesId: 1 } }, full: false }, 100);
  assert.deepEqual(Object.keys(incremental.ratings), ['1', '2']);
  const full = publishScan(old, { ratings: { 1: { seriesId: 1 } }, full: true }, 100);
  assert.deepEqual(Object.keys(full.ratings), ['1']);
});
