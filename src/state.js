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
      ratings: Object.assign({}, part.ratings || {}),
      updatedAt: now
    };
    return next;
  }

  function publishScan(state, result, now) {
    const next = Object.assign({}, state || {});
    next.ratings = result.full
      ? Object.assign({}, result.ratings || {})
      : Object.assign({}, next.ratings || {}, result.ratings || {});
    next.scan = { complete: true, nextPage: 1, updatedAt: now, full: !!result.full };
    return next;
  }

  return { accountKey, acquireLease, scanCheckpoint, publishScan };
});
