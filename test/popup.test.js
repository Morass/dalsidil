const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
global.DalsiDilI18n = require('../src/i18n.js');
const { render, start } = require('../popup/popup.js');

const page = () => new JSDOM('<main><p id="status"></p><ol id="results"></ol><section id="setup"><input id="profile"></section></main>').window.document;

test('blocked state is visible and is not rendered as an empty finished list', () => {
  const doc = page();
  render(doc, { status: 'challenge', items: [] });
  assert.match(doc.querySelector('#status').textContent, /ČSFD.*zablokovalo/i);
  assert.equal(doc.querySelector('#results').hidden, true);
});

test('results link to the next episode and explain progress', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Columbo', next: { href: '/film/1-show/2-next/prehled/', title: 'Next', code: 'S05E02' }, after: 'S05E01' }] });
  const row = doc.querySelector('li');
  assert.match(row.textContent, /Columbo/);
  assert.match(row.textContent, /naposledy: S05E01/i);
  assert.match(row.querySelector('a').href, /2-next/);
});

test('Czech is the default and English can be selected', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Columbo', next: { href: '/film/1-show/2-next/prehled/' }, after: 'S05E01' }] });
  assert.match(doc.querySelector('li').textContent, /Naposledy/);
  render(doc, { status: 'ready', locale: 'en', items: [{ seriesTitle: 'Columbo', next: { href: '/film/1-show/2-next/prehled/' }, after: 'S05E01' }] });
  assert.match(doc.querySelector('li').textContent, /Last rated/);
});

test('a ready result does not describe success as a stopped refresh', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Show', next: { href: '/film/1-show/2-next/prehled/' } }] });
  assert.equal(doc.querySelector('#status').hidden, true);
  assert.equal(doc.querySelector('#status').textContent, '');
});

test('a next episode parsed from sk links back to sk', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Show', next: { href: '/film/1-show/2-next/prehled/', host: 'https://www.csfd.sk', title: 'Next' } }] });
  assert.equal(doc.querySelector('a').origin, 'https://www.csfd.sk');
});

test('foreign and unsafe cached links are never rendered', () => {
  for (const href of ['https://example.org/collect', 'javascript:alert(1)']) {
    const doc = page();
    render(doc, { status: 'ready', items: [{ seriesTitle: 'Unsafe', next: { href } }] });
    assert.equal(doc.querySelector('a'), null);
  }
});

test('an incomplete first scan is named as partial rather than complete', () => {
  const doc = page();
  render(doc, { status: 'scanning', partial: true, page: 6, items: [] });
  assert.match(doc.querySelector('#status').textContent, /stále.*stránka 6/i);
});

test('every failure family is rendered as an actionable visible status', () => {
  const cases = [
    ['parser-unavailable', /čtení ČSFD.*dostupné/i],
    ['http-503', /503|temporarily/i],
    ['error', /nepodařilo/i],
    ['setup', /přihlaste|profilu/i]
  ];
  for (const [status, expected] of cases) {
    const doc = page();
    render(doc, { status, items: [], message: `Refresh stopped: ${status}` });
    assert.equal(doc.querySelector('#status').hidden, false, status);
    assert.match(doc.querySelector('#status').textContent, expected, status);
  }
});

test('a specific account or input warning is not hidden by a generic status', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [], message: 'Could not confirm the current ČSFD login.' });
  assert.match(doc.querySelector('#status').textContent, /could not confirm/i);
  render(doc, { status: 'error', items: [], message: 'That is not a ČSFD profile URL.' });
  assert.match(doc.querySelector('#status').textContent, /not a ČSFD profile/i);
});

test('worker message keys are localized', () => {
  const doc = page();
  render(doc, { status: 'error', locale: 'sk', messageKey: 'invalidProfile', items: [] });
  assert.match(doc.querySelector('#status').textContent, /platná adresa profilu/i);
  render(doc, { status: 'ready', locale: 'cs', messageKey: 'loginUnconfirmed', items: [] });
  assert.match(doc.querySelector('#status').textContent, /nepodařilo ověřit/i);
});

function startupPage() {
  return new JSDOM('<main><p id="status"></p><ol id="results"></ol><input id="count"><input id="profile"><button id="refresh"></button><button id="full-refresh"></button></main>').window.document;
}

test('startup paints a busy state before waiting for storage or network', async () => {
  const doc = startupPage();
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const started = start(doc, { async send(message) {
    if (message.type === 'state') return waiting;
    return { changed: false, state: { status: 'setup', count: 10, items: [] } };
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(doc.querySelector('#status').textContent, /zjišťuji/i);
  assert.equal(doc.querySelector('main').getAttribute('aria-busy'), 'true');
  release({ status: 'setup', count: 10, items: [] });
  await started;
});

test('a newly detected account shows scanning before its refresh finishes', async () => {
  const doc = startupPage();
  let releaseRefresh;
  const waiting = new Promise((resolve) => { releaseRefresh = resolve; });
  const started = start(doc, { async send(message) {
    if (message.type === 'state') return { status: 'setup', count: 10, items: [] };
    if (message.type === 'detect') return { changed: true, state: { status: 'idle', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] } };
    return waiting;
  } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(doc.querySelector('#status').textContent, /procházím/i);
  assert.equal(doc.querySelector('main').getAttribute('aria-busy'), 'true');
  releaseRefresh({ status: 'ready', count: 10, items: [] });
  await started;
});

test('startup scans after discovering a different signed-in account', async () => {
  const calls = [];
  const api = { async send(message) {
    calls.push(message);
    if (message.type === 'state') return { status: 'setup', count: 10, items: [] };
    if (message.type === 'detect') return { changed: true, state: { status: 'idle', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] } };
    return { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  } };
  await start(startupPage(), api);
  assert.deepEqual(calls.map((call) => call.type), ['state', 'detect', 'refresh']);
});

test('startup does not rescan when the active signed-in account is unchanged', async () => {
  const calls = [];
  const state = { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(startupPage(), { async send(message) {
    calls.push(message);
    return message.type === 'detect' ? { changed: false, state } : state;
  } });
  assert.deepEqual(calls.map((call) => call.type), ['state', 'detect']);
});

test('an interrupted idle account restarts its first scan', async () => {
  const calls = [];
  const idle = { status: 'idle', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(startupPage(), { async send(message) {
    calls.push(message);
    if (message.type === 'detect') return { changed: false, state: idle };
    if (message.type === 'refresh') return { ...idle, status: 'ready' };
    return idle;
  } });
  assert.deepEqual(calls.map((call) => call.type), ['state', 'detect', 'refresh']);
});

test('a malformed detection reply becomes an error instead of leaving a spinner', async () => {
  const doc = startupPage();
  await start(doc, { async send(message) {
    if (message.type === 'state') return { status: 'setup', count: 10, items: [] };
    return { status: 'error', items: [] };
  } });
  assert.equal(doc.querySelector('main').getAttribute('aria-busy'), 'false');
  assert.match(doc.querySelector('#status').textContent, /nepodařilo/i);
});

test('a busy background scan is polled until its finished state appears', async () => {
  const doc = startupPage();
  const callbacks = [];
  let stateCalls = 0;
  const scanning = { status: 'scanning', page: 6, count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(doc, {
    schedule(fn) { callbacks.push(fn); },
    async send(message) {
      if (message.type === 'detect') return { changed: false, state: scanning };
      stateCalls += 1;
      return stateCalls === 1 ? scanning : { ...scanning, status: 'ready' };
    }
  });
  assert.equal(callbacks.length, 1);
  await callbacks.shift()();
  assert.equal(doc.querySelector('main').getAttribute('aria-busy'), 'false');
});

test('a refresh transport failure replaces the spinner with a visible error', async () => {
  const doc = startupPage();
  const state = { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(doc, { async send(message) {
    if (message.type === 'detect') return { changed: false, state };
    if (message.type === 'refresh') throw new Error('Message port closed');
    return state;
  } });
  doc.querySelector('#refresh').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(doc.querySelector('main').getAttribute('aria-busy'), 'false');
  assert.match(doc.querySelector('#status').textContent, /nepodařilo/i);
});

test('a button-started partial refresh begins background progress polling', async () => {
  const doc = startupPage();
  const callbacks = [];
  const ready = { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(doc, {
    schedule(fn) { callbacks.push(fn); },
    async send(message) {
      if (message.type === 'detect') return { changed: false, state: ready };
      if (message.type === 'refresh') return { ...ready, status: 'scanning', page: 6 };
      return ready;
    }
  });
  doc.querySelector('#refresh').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callbacks.length, 1);
});

test('an open popup follows a language change from extension storage', async () => {
  const doc = startupPage();
  const select = doc.createElement('select');
  select.id = 'locale';
  for (const value of ['cs', 'sk', 'en']) select.appendChild(Object.assign(doc.createElement('option'), { value }));
  doc.querySelector('main').appendChild(select);
  let changed;
  let state = { status: 'ready', locale: 'cs', count: 10, items: [] };
  await start(doc, {
    watch(fn) { changed = fn; },
    async send(message) { return message.type === 'detect' ? { changed: false, state } : state; }
  });
  state = { ...state, locale: 'en' };
  await changed();
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(select.value, 'en');
});
