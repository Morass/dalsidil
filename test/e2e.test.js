const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const parse = require('../src/parse.js');
const profile = require('../src/profile.js');

function workerHarness(routes) {
  const data = {};
  let listener;
  let alarmListener;
  let offscreenExists = false;
  let offscreenCreates = 0;
  const alarms = [];
  const cleared = [];
  const parsedRequests = [];
  const root = path.resolve(__dirname, '..');
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, crypto: globalThis.crypto || webcrypto,
    fetch: async (url) => {
      const body = routes[new URL(url).pathname + new URL(url).search];
      if (body == null) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => body };
    },
    chrome: {
      storage: { local: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(key) { delete data[key]; }
      } },
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
        getURL(pathname) { return `chrome-extension://test/${pathname}`; },
        async getContexts() { return offscreenExists ? [{}] : []; },
        async sendMessage(message) {
          parsedRequests.push(message.url);
          const target = new URL(message.url);
          const key = target.pathname + target.search;
          const route = routes[target.href] === undefined ? routes[key] : routes[target.href];
          if (route instanceof Error) throw route;
          const body = typeof route === 'function' ? await route() : route;
          if (body == null) return { error: 'http-404' };
          const doc = new JSDOM(body, { url: 'chrome-extension://test/offscreen/offscreen.html' }).window.document;
          const base = doc.createElement('base');
          base.href = message.url;
          doc.head.prepend(base);
          if (message.kind === 'profile') return { parsed: profile.detectProfile(doc, message.url) };
          if (message.kind === 'ratings') return { parsed: parse.parseRatingsPage(doc, message.activity, message.url) };
          if (message.kind === 'episode') return { parsed: parse.parseEpisodePage(doc, message.seriesId, message.url) };
          return { error: 'unknown-parser-request' };
        }
      },
      offscreen: { async createDocument() { offscreenExists = true; offscreenCreates += 1; } },
      alarms: {
        async create(name, options) { alarms.push({ name, options }); },
        async clear(name) { cleared.push(name); return true; },
        onAlarm: { addListener(fn) { alarmListener = fn; } }
      }
    }
  });
  context.globalThis = context;
  context.importScripts = (...names) => {
    for (const name of names) vm.runInContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), context, { filename: name });
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'src/worker.js'), 'utf8'), context, { filename: 'worker.js' });
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  return { send, data, alarms, cleared, parsedRequests, fireAlarm(name) { alarmListener({ name }); }, get offscreenCreates() { return offscreenCreates; } };
}

test('real worker flow turns a profile rating into a linked next episode', async () => {
  const ratings = `<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span><time datetime="2026-09-27"></time></td></tr></table>`;
  const episode = `<header><h2><a href="/film/9-show/prehled/">Show</a></h2><nav><a rel="next" href="/film/9-show/12-two/prehled/">next</a></nav></header>`;
  const app = workerHarness({ '/uzivatel/7-me/hodnoceni/': ratings, '/film/9-show/11-one/prehled/': episode });
  const state = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.equal(state.status, 'ready');
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].seriesTitle, 'Show');
  assert.match(state.items[0].next.href, /12-two/);
  assert.equal(app.data.settings.profile.id, 7);
});

test('opening the extension discovers the current signed-in account and scans it', async () => {
  const home = '<header class="page-header user-logged"><ul class="header-bar"><li><a class="profile" href="/uzivatel/7-me/">Me</a></li></ul></header>';
  const ratings = `<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span></td></tr></table>`;
  const episode = `<header><h2><a href="/film/9-show/prehled/">Show</a></h2><nav><a rel="next" href="/film/9-show/12-two/prehled/">next</a></nav></header>`;
  const app = workerHarness({ '/': home, '/uzivatel/7-me/hodnoceni/': ratings, '/film/9-show/11-one/prehled/': episode });
  const detected = await app.send({ type: 'detect' });
  assert.equal(detected.changed, true);
  assert.equal(app.offscreenCreates, 1);
  const state = await app.send({ type: 'refresh', full: false });
  assert.equal(state.status, 'ready');
  assert.equal(state.profile.id, 7);
  assert.equal(state.items.length, 1);
});

test('automatic detection replaces a stale saved account with the active login', async () => {
  const home = '<header class="page-header user-logged"><ul class="header-bar"><li><a class="profile" href="/uzivatel/8-current/">Me</a></li></ul></header>';
  const app = workerHarness({ '/': home, '/uzivatel/8-current/hodnoceni/': '<table></table>' });
  app.data.settings = { count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-old/' } };
  const detected = await app.send({ type: 'detect' });
  const state = detected.state;
  assert.equal(state.profile.id, 8);
  assert.equal(app.data.settings.profile.id, 8);
});

test('failed login detection names that cached account identity was not confirmed', async () => {
  const app = workerHarness({});
  app.data.settings = { count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-old/' } };
  const detected = await app.send({ type: 'detect' });
  assert.equal(detected.changed, false);
  assert.match(detected.state.message, /could not confirm.*login/i);
});

test('an unexpected worker error preserves cached rows in its visible error state', async () => {
  const app = workerHarness({});
  app.data.settings = { count: 10, profile: { id: 7, href: 'not a URL' } };
  app.data['account:7'] = { items: [{ seriesId: 1, seriesTitle: 'Cached Show', next: { href: '/film/1-show/2-next/prehled/' } }] };
  const state = await app.send({ type: 'detect' });
  assert.equal(state.status, 'error');
  assert.equal(state.items[0].seriesTitle, 'Cached Show');
});

test('definite logout clears the previously selected account', async () => {
  const signedOut = '<header class="page-header user-not-logged"></header>';
  const app = workerHarness({ 'https://www.csfd.cz/': signedOut, 'https://www.csfd.sk/': signedOut });
  app.data.settings = { count: 12, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-old/' } };
  app.data['account:7'] = { items: [{ private: 'derived' }] };
  const detected = await app.send({ type: 'detect' });
  assert.equal(detected.state.status, 'setup');
  assert.equal(app.data.settings.profile, undefined);
  assert.equal(app.data.settings.count, 12);
  assert.equal(app.data['account:7'], undefined);
});

test('login detection preserves a setting changed while its request is in flight', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const home = '<header class="page-header user-logged"><ul class="header-bar"><li><a class="profile" href="/uzivatel/8-current/">Me</a></li></ul></header>';
  const app = workerHarness({ '/': async () => { await waiting; return home; } });
  app.data.settings = { count: 10 };
  const detection = app.send({ type: 'detect' });
  await new Promise((resolve) => setImmediate(resolve));
  app.data.settings.count = 23;
  release();
  await detection;
  assert.equal(app.data.settings.count, 23);
});

test('an offscreen parser failure releases the scan lease with an explicit status', async () => {
  const app = workerHarness({ '/uzivatel/7-me/hodnoceni/': new Error('parser disappeared') });
  const state = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.equal(state.status, 'parser-unavailable');
  assert.equal(app.data['account:7'].lease, null);
});

test('a just-created offscreen parser gets one startup retry', async () => {
  let calls = 0;
  const ratings = '<table></table>';
  const app = workerHarness({ '/uzivatel/7-me/hodnoceni/': async () => {
    calls += 1;
    if (calls === 1) throw new Error('Receiving end does not exist');
    return ratings;
  } });
  const state = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.equal(state.status, 'ready');
  assert.equal(calls, 2);
});

test('a sk profile keeps ratings, episode resolution and result links on sk', async () => {
  const ratingsURL = 'https://www.csfd.sk/uzivatel/7-me/hodnoceni/';
  const episodeURL = 'https://www.csfd.sk/film/9-show/11-one/prehled/';
  const ratings = '<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span></td></tr></table>';
  const episode = '<header><h2><a href="/film/9-show/prehled/">Show</a></h2><nav><a rel="next" href="/film/9-show/12-two/prehled/">next</a></nav></header>';
  const app = workerHarness({ [ratingsURL]: ratings, [episodeURL]: episode });
  const state = await app.send({ type: 'profile', href: 'https://www.csfd.sk/uzivatel/7-me/' });
  assert.equal(state.items[0].next.host, 'https://www.csfd.sk');
  assert.ok(app.parsedRequests.includes(episodeURL));
  assert.equal(app.parsedRequests.some((url) => url.startsWith('https://www.csfd.cz/film/')), false);
});

test('an early continuation alarm is rescheduled until the persisted lease expires', async () => {
  const app = workerHarness({});
  app.data.settings = { count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' } };
  app.data['account:7'] = { scan: { complete: false, nextPage: 2, ratings: {} }, lease: { owner: 'old-worker', until: Date.now() + 120000 } };
  app.fireAlarm('continue-scan');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.alarms.some((alarm) => alarm.name === 'continue-scan' && alarm.options.delayInMinutes >= 1));
});

test('a profile URL copied without its trailing slash is accepted', async () => {
  const ratings = `<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a></td><td><span class="stars stars-4"></span></td></tr></table>`;
  const episode = `<div class="film-header"><h2><a href="/film/9-show/prehled/">Show</a></h2><h1>One (S01E01)</h1></div>`;
  const app = workerHarness({ '/uzivatel/7-me/hodnoceni/': ratings, '/film/9-show/11-one/prehled/': episode });
  const state = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me' });
  assert.notEqual(state.status, 'error');
  assert.equal(app.data.settings.profile.id, 7);
});

test('real worker keeps cached items visible when a later resolve is blocked', async () => {
  const ratings = `<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span><time datetime="2026-09-27"></time></td></tr></table>`;
  const episode = `<header><h2><a href="/film/9-show/prehled/">Show</a></h2><nav><a rel="next" href="/film/9-show/12-two/prehled/">next</a></nav></header>`;
  const routes = { '/uzivatel/7-me/hodnoceni/': ratings, '/film/9-show/11-one/prehled/': episode };
  const app = workerHarness(routes);
  const first = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.equal(first.items.length, 1);
  app.data['account:7'].resolved = {};
  routes['/film/9-show/11-one/prehled/'] = '<main id="anubis_challenge"></main>';
  const second = await app.send({ type: 'refresh', full: false });
  assert.equal(second.status, 'challenge');
  assert.equal(second.items.length, 1);
});

test('a completed scan cancels the checkpoint continuation alarm', async () => {
  const ratings = `<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span></td></tr></table>`;
  const episode = `<header><h2><a href="/film/9-show/prehled/">Show</a></h2></header>`;
  const app = workerHarness({ '/uzivatel/7-me/hodnoceni/': ratings, '/film/9-show/11-one/prehled/': episode });
  await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.ok(app.alarms.some((x) => x.name === 'continue-scan'), 'checkpoint arms recovery');
  assert.ok(app.cleared.includes('continue-scan'), 'completion cancels recovery');
});

test('full rescan abandons a partial incremental accumulator and removes stale series', async () => {
  const routes = {};
  for (let page = 1; page <= 6; page += 1) {
    routes[`/uzivatel/7-me/hodnoceni/${page > 1 ? `?page=${page}` : ''}`] = `<table><tr><td class="name"><a class="film-title-name" href="/film/${page}-show/${page}1-one/prehled/">One</a></td><td><span class="stars stars-4"></span></td></tr></table>${page < 6 ? '<a class="page-next">next</a>' : ''}`;
    routes[`/film/${page}-show/${page}1-one/prehled/`] = `<div class="film-header"><h2><a href="/film/${page}-show/prehled/">Show</a></h2></div>`;
  }
  const app = workerHarness(routes);
  const partial = await app.send({ type: 'profile', href: 'https://www.csfd.cz/uzivatel/7-me/' });
  assert.equal(partial.status, 'scanning');
  assert.ok(Object.keys(app.data['account:7'].scan.ratings).length > 0);
  routes['/uzivatel/7-me/hodnoceni/'] = '<table></table>';
  const complete = await app.send({ type: 'refresh', full: true });
  assert.equal(complete.status, 'ready');
  assert.deepEqual(Object.keys(app.data['account:7'].ratings), []);
});
