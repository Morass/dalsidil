(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilState = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function accountKey(profileId) {
    const id = Number(profileId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('invalid profile id');
    return `account:${id}`;
  }

  function acquireLease(current, owner, now, ttl) {
    if (!owner) throw new Error('lease owner required');
    if (current && current.until > now && current.owner !== owner) return null;
    return { owner, until: now + ttl };
  }

  function scanCheckpoint(state, part, now) {
    const next = Object.assign({}, state || {});
    next.scan = {
      complete: false,
      nextPage: Number(part.page) + 1,
      ratings: Object.assign({}, next.scan && next.scan.ratings || {}, part.ratings || {}),
      updatedAt: now
    };
    return next;
  }

  function publishScan(state, result, now) {
    const next = Object.assign({}, state || {});
    if (result.full) {
      next.ratings = Object.assign({}, result.ratings || {});
    } else {
      next.ratings = Object.assign({}, next.ratings || {});
      for (const [key, value] of Object.entries(result.ratings || {})) {
        const prior = next.ratings[key] || {};
        next.ratings[key] = Object.assign({}, prior, value, {
          signatures: Object.assign({}, prior.signatures || {}, value.signatures || {})
        });
      }
    }
    next.scan = { complete: true, nextPage: 1, updatedAt: now, full: !!result.full };
    return next;
  }

  return { accountKey, acquireLease, scanCheckpoint, publishScan };
});
