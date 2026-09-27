const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

function workerHarness(routes) {
  const data = {};
  let listener;
  const alarms = [];
  const cleared = [];
  const root = path.resolve(__dirname, '..');
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, crypto: globalThis.crypto || webcrypto,
    DOMParser: new JSDOM('').window.DOMParser,
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
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
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
