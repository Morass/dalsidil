(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilParse = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const HOSTS = new Set(['www.csfd.cz', 'www.csfd.sk']);

  function safeUrl(href, base) {
    try {
      let origin = null;
      try {
        const parsedBase = new URL(base || 'https://www.csfd.cz/');
        if (parsedBase.protocol === 'https:' && HOSTS.has(parsedBase.hostname)) origin = parsedBase;
      } catch (_) { /* use the safe default */ }
      const effectiveBase = origin || new URL('https://www.csfd.cz/');
      const url = new URL(href, effectiveBase);
      return url.protocol === 'https:' && url.hostname === effectiveBase.hostname ? url : null;
    } catch (_) { return null; }
  }

  function episodeIds(href, base) {
    const url = safeUrl(href, base);
    if (!url) return null;
    const match = /^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?)film\/(\d+)-([^/]+)\/(\d+)-([^/]+)\/(?:[^/]+\/)?$/.exec(url.pathname);
    if (!match) return null;
    return {
      seriesId: Number(match[2]),
      episodeId: Number(match[4]),
      href: `${match[1]}film/${match[2]}-${match[3]}/${match[4]}-${match[5]}/prehled/`
    };
  }

  function blocked(doc) {
    return !!doc.querySelector('#anubis_challenge') || /making sure you are not a bot/i.test(doc.body && doc.body.textContent || '');
  }

  function parseRatingsPage(doc, firstActivity) {
    if (blocked(doc)) return { episodes: [], hasNext: false, blocked: true };
    const episodes = [];
    let activity = Number(firstActivity) || 0;
    for (const row of doc.querySelectorAll('table tr')) {
      const link = row.querySelector('td.name a.film-title-name, a.film-title-name');
      if (!link) continue;
      const ids = episodeIds(link.getAttribute('href'), doc.baseURI);
      const codeMatch = /\bS(\d{1,3})E(\d{1,4})\b/i.exec(row.textContent || '');
      if (!ids || !codeMatch) continue;
      const starNode = row.querySelector('.stars');
      const starMatch = /(?:^|\s)stars-(\d)(?:\s|$)/.exec(starNode && starNode.className || '');
      if (!starMatch) continue;
      const time = row.querySelector('time');
      const date = time && (time.getAttribute('datetime') || time.textContent.trim()) || '';
      const code = `S${codeMatch[1].padStart(2, '0')}E${codeMatch[2].padStart(2, '0')}`;
      episodes.push(Object.assign(ids, {
        code,
        title: link.textContent.trim(),
        stars: Number(starMatch[1]),
        date,
        activity: activity--,
        signature: `${ids.episodeId}:${starMatch[1]}:${date}`
      }));
    }
    const next = doc.querySelector('.page-next');
    return { episodes, hasNext: !!next && !next.classList.contains('disabled'), blocked: false };
  }

  function parseEpisodePage(doc, expectedSeriesId) {
    if (blocked(doc)) return { next: null, blocked: true };
    const expected = Number(expectedSeriesId);
    if (!Number.isInteger(expected) || expected <= 0) return { next: null, blocked: false };
    const header = doc.querySelector('.film-header, header');
    if (!header) return { next: null, blocked: false };
    const links = [...header.querySelectorAll('a[href]')];
    const breadcrumbPaths = new Set([...header.querySelectorAll('h2 a[href]')]
      .map((link) => safeUrl(link.getAttribute('href'), doc.baseURI))
      .filter(Boolean)
      .map((url) => url.pathname));
    let seriesTitle = '';
    for (const link of links) {
      const url = safeUrl(link.getAttribute('href'), doc.baseURI);
      const match = url && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?film\/(\d+)-[^/]+\/(?:prehled\/)?$/.exec(url.pathname);
      if (match && Number(match[1]) === expected) { seriesTitle = link.textContent.trim(); break; }
    }
    let next = null;
    for (const link of links) {
      const label = `${link.getAttribute('rel') || ''} ${link.textContent || ''} ${link.getAttribute('title') || ''}`;
      if (!/(^|\s)next(\s|$)|další|nasleduj|weiter|suivant|siguiente|następn/i.test(label)) continue;
      const ids = episodeIds(link.getAttribute('href'), doc.baseURI);
      if (ids && ids.seriesId === expected && !breadcrumbPaths.has(ids.href)) {
        const text = link.textContent.trim();
        const code = /\bS\d{1,3}E\d{1,4}\b/i.exec(text);
        next = Object.assign(ids, { title: text && !/^(next|další|nasledujúci)$/i.test(text) ? text : '', code: code ? code[0].toUpperCase() : null });
        break;
      }
    }
    return { seriesTitle, next, blocked: false };
  }

  return { safeUrl, episodeIds, parseRatingsPage, parseEpisodePage };
});
