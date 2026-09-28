const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRatings, rankedSeries, compareProgress } = require('../src/model.js');

const episode = (seriesId, episodeId, code, activity, title = 'Episode') => ({
  seriesId, episodeId, code, activity, title,
  href: `/film/${seriesId}-show/${episodeId}-episode/prehled/`,
  signature: `${episodeId}:5:${activity}`
});

test('a late vote on an older episode changes activity but never rewinds progress', () => {
  const rows = [episode(10, 105, 'S05E01', 1), episode(10, 23, 'S02E03', 9)];
  const series = rankedSeries(mergeRatings({}, rows));
  assert.equal(series[0].activity, 9);
  assert.equal(series[0].progress.code, 'S05E01');
  assert.equal(series[0].progress.episodeId, 105);
});

test('an older numeric episode id cannot rewind progress when codes are absent', () => {
  const existing = mergeRatings({}, [episode(1, 20, null, 1)]);
  const next = mergeRatings(existing, [episode(1, 2, null, 2)]);
  assert.equal(next['1'].progress.episodeId, 20);
  assert.equal(next['1'].activity, 2);
});

test('series are ranked by newest activity, not furthest episode number', () => {
  const rows = [episode(1, 99, 'S09E09', 2), episode(2, 11, 'S01E01', 8)];
  assert.deepEqual(rankedSeries(mergeRatings({}, rows)).map((x) => x.seriesId), [2, 1]);
});

test('specials do not outrank numbered progress by invented arithmetic', () => {
  assert.equal(compareProgress({ code: 'Special' }, { code: 'S02E03' }), -1);
  assert.equal(compareProgress({ code: 'S02E04' }, { code: 'S02E03' }), 1);
});

test('between two irregular episodes the newer activity remains the progress URL', () => {
  const rows = [episode(10, 7, 'Special', 1), episode(10, 8, 'Bonus', 9)];
  assert.equal(rankedSeries(mergeRatings({}, rows))[0].progress.episodeId, 8);
});

test('a complete replacement removes deleted ratings but an incremental merge does not', () => {
  const old = mergeRatings({}, [episode(1, 1, 'S01E01', 1), episode(2, 2, 'S01E01', 2)]);
  const partial = mergeRatings(old, [episode(1, 1, 'S01E01', 3)]);
  assert.equal(Object.keys(partial).length, 2);
  const replaced = mergeRatings({}, [episode(1, 1, 'S01E01', 3)]);
  assert.deepEqual(Object.keys(replaced), ['1']);
});
