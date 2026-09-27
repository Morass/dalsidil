const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createScanner } = require('../src/scan.js');

const ratingPage = (episode, next = false) => `<table><tr><td class="name"><a class="film-title-name" href="/film/${episode.series}-show/${episode.id}-episode/prehled/">${episode.title}</a> (S${episode.season}E${episode.number})</td><td><span class="stars stars-4"></span><time datetime="${episode.date}"></time></td></tr></table>${next ? '<a class="page-next">next</a>' : ''}`;
const episodePage = (series, nextId, title = 'Show') => `<header><h2><a href="/film/${series}-show/prehled/">${title}</a></h2>${nextId ? `<nav><a rel="next" href="/film/${series}-show/${nextId}-next/prehled/">next</a></nav>` : ''}</header>`;

test('a scan checkpoints each page and stops at the configured chunk bound', async () => {
  const checkpoints = [];
  const fetch = async (url) => ({ ok: true, text: async () => ratingPage({ series: 1, id: Number(new URL(url).searchParams.get('page') || 1), title: 'E', season: '01', number: '01', date: '2026-01-01' }, true) });
  const scanner = createScanner({ fetch, parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document, sleep: async () => {}, pagesPerRun: 2 });
  const out = await scanner.scanRatings({ href: 'https://www.csfd.cz/uzivatel/7-me/', id: 7 }, null, (x) => checkpoints.push(x));
  assert.equal(out.complete, false);
  assert.equal(out.nextPage, 3);
  assert.deepEqual(checkpoints.map((x) => x.page), [1, 2]);
});

test('a challenge is an explicit blocked outcome and keeps the resume page', async () => {
  const scanner = createScanner({ fetch: async () => ({ ok: true, text: async () => '<main id="anubis_challenge"></main>' }), parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document });
  const out = await scanner.scanRatings({ href: 'https://www.csfd.cz/uzivatel/7-me/', id: 7 }, { nextPage: 4, ratings: {} });
  assert.equal(out.stopped, 'challenge');
  assert.equal(out.nextPage, 4);
});

test('an incremental scan stops on a page whose episode signatures are already known', async () => {
  const html = ratingPage({ series: 1, id: 2, title: 'E', season: '01', number: '02', date: '2026-01-01' }, true);
  const fetch = async () => ({ ok: true, text: async () => html });
  const scanner = createScanner({ fetch, parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document, sleep: async () => {}, pagesPerRun: 1 });
  const known = { 1: { seriesId: 1, activity: 1, progress: {}, signatures: { 2: '2:4:2026-01-01' } } };
  const out = await scanner.scanRatings({ href: 'https://www.csfd.cz/uzivatel/7-me/', id: 7 }, { nextPage: 1, ratings: known, incremental: true });
  assert.equal(out.complete, false, 'one unchanged page is not a safe boundary');
});

test('an incremental scan checks two unchanged pages before stopping', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return { ok: true, text: async () => ratingPage({ series: 1, id: calls, title: 'E', season: '01', number: `0${calls}`, date: '2026-01-01' }, true) };
  };
  const known = { 1: { seriesId: 1, activity: 1, progress: {}, signatures: { 1: '1:4:2026-01-01', 2: '2:4:2026-01-01' } } };
  const scanner = createScanner({ fetch, parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document, sleep: async () => {} });
  const out = await scanner.scanRatings({ href: 'https://www.csfd.cz/uzivatel/7-me/', id: 7 }, { nextPage: 1, ratings: known, incremental: true });
  assert.equal(out.complete, true);
  assert.equal(calls, 2);
  assert.equal(out.full, false);
});

test('resolver skips finished series and returns up to the requested live count', async () => {
  const pages = new Map([
    ['/film/1-show/11-episode/prehled/', episodePage(1, null, 'Done')],
    ['/film/2-show/22-episode/prehled/', episodePage(2, 23, 'Live')]
  ]);
  const fetch = async (url) => ({ ok: true, text: async () => pages.get(new URL(url).pathname) });
  const scanner = createScanner({ fetch, parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document, sleep: async () => {} });
  const candidates = [
    { seriesId: 1, activity: 2, progress: { href: '/film/1-show/11-episode/prehled/', code: 'S01E01', signature: '11' } },
    { seriesId: 2, activity: 1, progress: { href: '/film/2-show/22-episode/prehled/', code: 'S01E01', signature: '22' } }
  ];
  const out = await scanner.resolve(candidates, 1, {});
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].seriesTitle, 'Live');
  assert.equal(out.asked, 2);
});

test('a cached finished series is rechecked after its short expiry', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return { ok: true, text: async () => episodePage(1, 12, 'Returned') }; };
  const scanner = createScanner({ fetch, parseHTML: (s, u) => new JSDOM(s, { url: u }).window.document, sleep: async () => {}, now: () => 200000000 });
  const candidate = { seriesId: 1, activity: 1, progress: { href: '/film/1-show/11-episode/prehled/', code: 'S01E01', signature: '11' } };
  const cache = { 1: { signature: '11', seriesTitle: 'Done', next: null, checkedAt: 1 } };
  const out = await scanner.resolve([candidate], 1, cache);
  assert.equal(calls, 1);
  assert.equal(out.items[0].seriesTitle, 'Returned');
});

test('a resolver failure returns its status without claiming a complete replacement list', async () => {
  const scanner = createScanner({ fetch: async () => { throw new Error('offline'); }, parseHTML: () => null });
  const candidate = { seriesId: 1, activity: 1, progress: { href: '/film/1-show/11-episode/prehled/', code: 'S01E01', signature: '11' } };
  const out = await scanner.resolve([candidate], 1, {});
  assert.equal(out.stopped, 'network');
  assert.equal(out.complete, false);
});
