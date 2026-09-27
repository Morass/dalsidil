(function (root, factory) {
  const parse = typeof module === 'object' && module.exports ? require('./parse.js') : root.DalsiDilParse;
  const model = typeof module === 'object' && module.exports ? require('./model.js') : root.DalsiDilModel;
  const api = factory(parse, model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilScan = api;
})(typeof globalThis === 'object' ? globalThis : this, function (parse, model) {
  'use strict';
  const RESOLVER_VERSION = 2;

  function createScanner(options) {
    const opt = options || {};
    const fetchImpl = opt.fetch || fetch;
    const parseHTML = opt.parseHTML || ((html) => new DOMParser().parseFromString(html, 'text/html'));
    const sleep = opt.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const pace = opt.pace == null ? 700 : opt.pace;
    const pagesPerRun = opt.pagesPerRun || 5;
    const now = opt.now || Date.now;
    const finishedMaxAge = opt.finishedMaxAge || 24 * 60 * 60 * 1000;
    const loadRatings = opt.loadRatings || null;
    const loadEpisode = opt.loadEpisode || null;

    function ratingsUrl(profile, page) {
      const base = new URL(profile.href);
      const suffix = /^\/en\/user\//.test(base.pathname) ? 'ratings/' : 'hodnoceni/';
      base.pathname = base.pathname.replace(/\/$/, '') + '/' + suffix;
      base.search = page > 1 ? `?page=${page}` : '';
      return base.href;
    }

    async function getDocument(url) {
      let response;
      try { response = await fetchImpl(url, { credentials: 'include', redirect: 'error' }); }
      catch (_) { return { error: 'network' }; }
      if (!response.ok) return { error: `http-${response.status}` };
      const html = await response.text();
      return { doc: parseHTML(html, url) };
    }

    async function scanRatings(profile, resume, onCheckpoint) {
      const start = Math.max(1, Number(resume && resume.nextPage) || 1);
      let ratings = Object.assign({}, resume && resume.ratings || {});
      let knownStreak = Number(resume && resume.knownStreak) || 0;
      const activityBase = Number(resume && resume.activityBase) || now() * 1000;
      for (let offset = 0; offset < pagesPerRun; offset += 1) {
        const page = start + offset;
        const loaded = loadRatings
          ? await loadRatings(ratingsUrl(profile, page), activityBase - (page - 1) * 1000)
          : await getDocument(ratingsUrl(profile, page));
        if (loaded.error) return { ratings, complete: false, nextPage: page, stopped: loaded.error };
        const parsed = loaded.parsed || parse.parseRatingsPage(loaded.doc, activityBase - (page - 1) * 1000);
        if (parsed.blocked) return { ratings, complete: false, nextPage: page, stopped: 'challenge' };
        const alreadyKnown = !!(resume && resume.incremental && parsed.episodes.length) && parsed.episodes.every((item) => {
          const series = ratings[String(item.seriesId)];
          return series && series.signatures && series.signatures[item.episodeId] === item.signature;
        });
        ratings = model.mergeRatings(ratings, parsed.episodes);
        if (onCheckpoint) await onCheckpoint({ page, ratings, activityBase, complete: false });
        knownStreak = alreadyKnown ? knownStreak + 1 : 0;
        if (knownStreak >= 2) return { ratings, complete: true, full: false, nextPage: 1, stopped: null };
        if (!parsed.hasNext) return { ratings, complete: true, full: !(resume && resume.incremental), nextPage: 1, stopped: null };
        if (pace) await sleep(pace);
      }
      return { ratings, complete: false, nextPage: start + pagesPerRun, knownStreak, activityBase, stopped: 'chunk' };
    }

    async function resolve(candidates, limit, cache) {
      const items = [];
      const resolved = Object.assign({}, cache || {});
      let asked = 0;
      for (const series of candidates) {
        if (items.length >= limit) break;
        const signature = series.progress && series.progress.signature || String(series.progress && series.progress.episodeId || '');
        let entry = resolved[series.seriesId];
        const staleFinished = entry && !entry.next && now() - Number(entry.checkedAt || 0) >= finishedMaxAge;
        const oldParser = entry && entry.version !== RESOLVER_VERSION;
        if (!entry || entry.signature !== signature || staleFinished || oldParser) {
          const url = new URL(series.progress.href, series.progress.host || opt.origin || 'https://www.csfd.cz/').href;
          const loaded = loadEpisode ? await loadEpisode(url, series.seriesId) : await getDocument(url);
          asked += 1;
          if (loaded.error) {
            if (/^http-(?:404|410)$/.test(loaded.error)) continue;
            return { items, cache: resolved, asked, stopped: loaded.error, complete: false };
          }
          const parsed = loaded.parsed || parse.parseEpisodePage(loaded.doc, series.seriesId);
          if (parsed.blocked) return { items, cache: resolved, asked, stopped: 'challenge', complete: false };
          entry = { version: RESOLVER_VERSION, signature, seriesTitle: parsed.seriesTitle, currentCode: parsed.currentCode, next: parsed.next, checkedAt: now() };
          resolved[series.seriesId] = entry;
          if (pace) await sleep(pace);
        }
        if (entry.next) items.push({ seriesId: series.seriesId, seriesTitle: entry.seriesTitle || `Series ${series.seriesId}`, next: entry.next, after: entry.currentCode || series.progress.code || series.progress.title });
      }
      return { items, cache: resolved, asked, stopped: null, complete: true };
    }

    return { scanRatings, resolve, ratingsUrl };
  }

  return { createScanner };
});
