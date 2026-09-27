(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function numericCode(code) {
    const match = /^S(\d+)E(\d+)$/i.exec(String(code || '').trim());
    return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
  }

  function compareProgress(a, b) {
    const left = numericCode(a && a.code);
    const right = numericCode(b && b.code);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    return left.season - right.season || left.episode - right.episode;
  }

  function mergeRatings(existing, episodes) {
    const result = Object.assign({}, existing || {});
    for (const item of episodes || []) {
      if (!Number.isInteger(item.seriesId) || !Number.isInteger(item.episodeId)) continue;
      const key = String(item.seriesId);
      const prior = result[key] || { seriesId: item.seriesId, activity: -1, progress: null, signatures: {} };
      const signatures = Object.assign({}, prior.signatures || {});
      signatures[item.episodeId] = item.signature || String(item.episodeId);
      const progress = !prior.progress || compareProgress(item, prior.progress) > 0 ? item : prior.progress;
      const latest = item.activity >= prior.activity ? item : prior.latest;
      result[key] = {
        seriesId: item.seriesId,
        activity: Math.max(prior.activity, item.activity),
        latest,
        progress,
        signatures
      };
    }
    return result;
  }

  function rankedSeries(ratings) {
    return Object.values(ratings || {}).sort((a, b) => b.activity - a.activity || a.seriesId - b.seriesId);
  }

  return { numericCode, compareProgress, mergeRatings, rankedSeries };
});
