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
  const alarms = [];
  const cleared = [];
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
        async set(values) { Object.assign(data, structuredClone(values)); }
      } },
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
        getURL(pathname) { return `chrome-extension://test/${pathname}`; },
        async getContexts() { return [{}]; },
        async sendMessage(message) {
          const key = new URL(message.url).pathname + new URL(message.url).search;
          const route = routes[key];
          const body = typeof route === 'function' ? await route() : route;
          if (body == null) return { error: 'http-404' };
          const doc = new JSDOM(body, { url: message.url }).window.document;
          if (message.kind === 'profile') return { parsed: profile.detectProfile(doc, message.url) };
          if (message.kind === 'ratings') return { parsed: parse.parseRatingsPage(doc, message.activity) };
          if (message.kind === 'episode') return { parsed: parse.parseEpisodePage(doc, message.seriesId) };
          return { error: 'unknown-parser-request' };
        }
      },
      offscreen: { async createDocument() {} },
      alarms: {
        async create(name, options) { alarms.push({ name, options }); },
        async clear(name) { cleared.push(name); return true; },
        onAlarm: { addListener() {} }
      }
    }
  });
  context.globalThis = context;
  context.importScripts = (...names) => {
    for (const name of names) vm.runInContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), context, { filename: name });
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'src/worker.js'), 'utf8'), context, { filename: 'worker.js' });
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  return { send, data, alarms, cleared };
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
