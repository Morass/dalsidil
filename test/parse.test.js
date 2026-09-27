const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseRatingsPage, parseEpisodePage } = require('../src/parse.js');

const doc = (html, url = 'https://www.csfd.cz/') => new JSDOM(html, { url }).window.document;

test('ratings parser keeps episode identity, S/E code, stars, date and next-page state', () => {
  const page = doc(`<table><tr><td class="name"><a class="film-title-name" href="/film/237899-columbo/43366-case/prehled/">A Case</a> (epizoda) (S05E02)</td><td><span class="stars stars-4"></span><time datetime="2026-09-20">20. 9. 2026</time></td></tr></table><a class="page-next" href="?page=2">další</a>`);
  const out = parseRatingsPage(page, 50);
  assert.equal(out.episodes[0].seriesId, 237899);
  assert.equal(out.episodes[0].episodeId, 43366);
  assert.equal(out.episodes[0].code, 'S05E02');
  assert.equal(out.episodes[0].stars, 4);
  assert.equal(out.episodes[0].activity, 50);
  assert.equal(out.hasNext, true);
});

test('film ratings and malformed cross-origin links are ignored', () => {
  const page = doc(`<table><tr><td class="name"><a class="film-title-name" href="/film/2294-pulp-fiction/prehled/">Film</a></td></tr><tr><td class="name"><a class="film-title-name" href="https://evil.example/film/1-a/2-b/">Bad</a> (S01E01)</td></tr></table>`);
  assert.deepEqual(parseRatingsPage(page, 1).episodes, []);
});

test('episode parser follows the canonical next link within the same series', () => {
  const page = doc(`<header><h2><a href="/film/237899-columbo/prehled/">Columbo</a> - <a href="/film/237899-columbo/626083-season-5/prehled/">5. série</a></h2><h1>A Case (S05E02)</h1><nav><a href="/film/237899-columbo/40000-prev/prehled/">předchozí</a><a rel="next" href="/film/237899-columbo/44456-next/prehled/">další</a></nav></header>`);
  const out = parseEpisodePage(page, 237899);
  assert.equal(out.seriesTitle, 'Columbo');
  assert.equal(out.next.code, null);
  assert.match(out.next.href, /44456-next/);
});

test('episode parser reports finished when no same-series next link exists', () => {
  const page = doc(`<header><h2><a href="/film/9-show/prehled/">Show</a></h2><a rel="next" href="/film/8-other/3-no/prehled/">next</a></header>`);
  assert.equal(parseEpisodePage(page, 9).next, null);
});

test('BotStopper markup is identified instead of parsed as an empty page', () => {
  const page = doc('<main id="anubis_challenge"><h1>Making sure you are not a bot!</h1></main>');
  assert.equal(parseRatingsPage(page, 1).blocked, true);
  assert.equal(parseEpisodePage(page, 1).blocked, true);
});
