const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
global.DalsiDilI18n = require('../src/i18n.js');
const { createLauncher } = require('../content/launcher.js');

function page(url = 'https://www.csfd.cz/film/1-show/prehled/') {
  return new JSDOM('<!doctype html><html><head></head><body><main>ČSFD</main></body></html>', { url });
}

function apiWith(state) {
  const messages = [];
  let storageListener;
  return {
    messages,
    runtime: {
      async sendMessage(message) { messages.push(message); return structuredClone(state); }
    },
    storage: { onChanged: {
      addListener(fn) { storageListener = fn; },
      removeListener(fn) { if (storageListener === fn) storageListener = undefined; }
    } },
    fireStorage(changes = {}, area = 'local') { if (storageListener) storageListener(changes, area); }
  };
}

test('launcher is attached directly to the document root with a closed shadow tree', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  const host = launcher.host();
  assert.equal(host.parentNode, dom.window.document.documentElement);
  assert.equal(host.shadowRoot, null);
  assert.equal(host.style.top, '18px');
  assert.equal(host.style.bottom, '');
  assert.equal(dom.window.document.body.textContent, 'ČSFD');
  launcher.stop();
});

test('startup replaces an orphaned launcher left by an invalidated extension context', async () => {
  const dom = page();
  const orphan = dom.window.document.createElement('div');
  orphan.dataset.dalsidilLauncher = '';
  dom.window.document.documentElement.appendChild(orphan);
  const launcher = createLauncher(dom.window.document, apiWith({ status: 'ready', items: [] }));
  await launcher.start();
  assert.equal(orphan.isConnected, false);
  assert.equal(dom.window.document.querySelectorAll('[data-dalsidil-launcher]').length, 1);
  launcher.stop();
});

test('opening the page panel reads cached state only and never requests detection or refresh', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [{
    seriesTitle: 'Columbo', after: 'S05E01',
    next: { href: '/film/9-columbo/12-next/prehled/', title: 'Next', code: 'S05E02' }
  }] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  assert.deepEqual(api.messages, [{ type: 'state' }]);
  launcher.click();
  assert.deepEqual(api.messages, [{ type: 'state' }]);
  assert.equal(launcher.snapshot().open, true);
  assert.equal(launcher.snapshot().rows[0].title, 'Columbo');
  assert.equal(launcher.snapshot().rows[0].href, 'https://www.csfd.cz/film/9-columbo/12-next/prehled/');
  launcher.stop();
});

test('page-panel refresh runs one incremental scan and paints its returned cache', async () => {
  const dom = page();
  const messages = [];
  let finishRefresh;
  const api = {
    runtime: { sendMessage(message) {
      messages.push(message);
      if (message.type === 'state') return Promise.resolve({ status: 'ready', items: [] });
      return new Promise((resolve) => { finishRefresh = resolve; });
    } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  const refreshing = launcher.refresh();
  assert.deepEqual(messages, [{ type: 'state' }, { type: 'refresh', full: false }]);
  assert.equal(launcher.snapshot().refreshDisabled, true);
  assert.match(launcher.snapshot().refreshStatus, /obnovuji/i);
  launcher.refresh();
  assert.equal(messages.length, 2, 'a second click cannot start a concurrent scan');
  finishRefresh({ status: 'ready', items: [{ seriesTitle: 'Fresh show', next: { href: '/film/3-show/4-next/prehled/' } }] });
  await refreshing;
  assert.equal(launcher.snapshot().rows[0].title, 'Fresh show');
  assert.equal(launcher.snapshot().refreshDisabled, false);
  assert.match(launcher.snapshot().refreshStatus, /hotovo/i);
  launcher.stop();
});

test('failed page-panel refresh keeps cached rows and offers retry', async () => {
  const dom = page();
  const api = {
    runtime: { async sendMessage(message) {
      if (message.type === 'state') return { status: 'ready', items: [{ seriesTitle: 'Cached', next: { href: '/film/3-show/4-next/prehled/' } }] };
      throw new Error('offline');
    } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  await launcher.refresh();
  assert.equal(launcher.snapshot().rows[0].title, 'Cached');
  assert.equal(launcher.snapshot().refreshDisabled, false);
  assert.match(launcher.snapshot().refreshStatus, /nepodařilo/i);
  launcher.stop();
});

test('cached Slovak links retain their origin in the page panel', async () => {
  const dom = page('https://www.csfd.sk/film/1-show/prehled/');
  const api = apiWith({ status: 'ready', items: [{
    seriesTitle: 'Show', next: { href: '/film/9-show/12-next/prehled/', host: 'https://www.csfd.sk' }
  }] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  assert.equal(launcher.snapshot().rows[0].href, 'https://www.csfd.sk/film/9-show/12-next/prehled/');
  launcher.stop();
});

test('removing the extension host causes one safe reattachment to the current document root', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  const original = launcher.host();
  original.remove();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.notEqual(launcher.host(), original);
  assert.equal(launcher.host().parentNode, dom.window.document.documentElement);
  assert.equal(dom.window.document.querySelectorAll('[data-dalsidil-launcher]').length, 1);
  launcher.stop();
});

test('replacing the whole page root moves the launcher to the replacement root', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  const replacement = dom.window.document.createElement('html');
  replacement.innerHTML = '<head></head><body><main>New ČSFD page</main></body>';
  dom.window.document.documentElement.replaceWith(replacement);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(launcher.host().parentNode, replacement);
  assert.equal(replacement.querySelectorAll('[data-dalsidil-launcher]').length, 1);
  launcher.stop();
});

test('a local storage change repaints from cached state without starting a scan', async () => {
  const dom = page();
  const state = { status: 'ready', items: [] };
  const api = apiWith(state);
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  state.items.push({ seriesTitle: 'New show', next: { href: '/film/3-show/4-next/prehled/' } });
  api.fireStorage({ 'account:7': { newValue: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(api.messages, [{ type: 'state' }, { type: 'state' }]);
  assert.equal(launcher.snapshot().rows[0].title, 'New show');
  launcher.stop();
});

test('an unchanged storage notification preserves the focused episode link', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [{
    seriesTitle: 'Show', next: { href: '/film/3-show/4-next/prehled/' }
  }] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  launcher.click();
  launcher.focusFirstLink();
  const focused = launcher.focusedLink();
  api.fireStorage({ 'account:7': { newValue: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launcher.focusedLink(), focused);
  launcher.stop();
});

test('a later runtime failure removes the launcher without resurrecting stale rows', async () => {
  const dom = page();
  let fail = false;
  let storageListener;
  const api = {
    runtime: { async sendMessage() {
      if (fail) throw new Error('extension unavailable');
      return { status: 'ready', items: [{ seriesTitle: 'Stale', next: { href: '/film/3-show/4-next/prehled/' } }] };
    } },
    storage: { onChanged: {
      addListener(fn) { storageListener = fn; },
      removeListener() {}
    } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  fail = true;
  storageListener({}, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launcher.host(), null);
  assert.equal(dom.window.document.querySelector('[data-dalsidil-launcher]'), null);
  launcher.stop();
});

test('out-of-order cached reads cannot resurrect or overwrite newer state', async () => {
  const dom = page();
  const pending = [];
  let storageListener;
  const api = {
    runtime: { sendMessage() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } },
    storage: { onChanged: {
      addListener(fn) { storageListener = fn; },
      removeListener() {}
    } }
  };
  const cached = (title) => ({ status: 'ready', items: [{ title, seriesTitle: title, next: { href: '/film/3-show/4-next/prehled/' } }] });
  const launcher = createLauncher(dom.window.document, api);
  const starting = launcher.start();
  pending.shift().resolve(cached('Initial'));
  await starting;

  storageListener({}, 'local');
  storageListener({}, 'local');
  const older = pending.shift();
  const newer = pending.shift();
  newer.reject(new Error('extension unavailable'));
  await new Promise((resolve) => setImmediate(resolve));
  older.resolve(cached('Stale'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launcher.host(), null, 'older success must not undo the newer failure');

  storageListener({}, 'local');
  storageListener({}, 'local');
  const oldSuccess = pending.shift();
  const newSuccess = pending.shift();
  newSuccess.resolve(cached('Newest'));
  await new Promise((resolve) => setImmediate(resolve));
  oldSuccess.resolve(cached('Older'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launcher.snapshot().rows[0].title, 'Newest');
  launcher.stop();
});

test('a storage change during startup supersedes the pending initial cache read', async () => {
  const dom = page();
  const pending = [];
  let storageListener;
  const api = {
    runtime: { sendMessage() { return new Promise((resolve) => pending.push(resolve)); } },
    storage: { onChanged: {
      addListener(fn) { storageListener = fn; },
      removeListener() {}
    } }
  };
  const launcher = createLauncher(dom.window.document, api);
  const starting = launcher.start();
  assert.equal(typeof storageListener, 'function');
  storageListener({ settings: { newValue: {} } }, 'local');
  pending.shift()({ status: 'ready', items: [{ seriesTitle: 'Old account', next: { href: '/film/3-show/4-next/prehled/' } }] });
  pending.shift()({ status: 'setup', items: [] });
  await starting;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(launcher.snapshot().rows, []);
  launcher.stop();
});

test('foreign cached links make the launcher fail closed', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [{
    seriesTitle: 'Foreign', next: { href: 'https://example.org/next' }
  }] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  assert.equal(launcher.host(), null);
});

test('cached links with credentials or nondefault ports make the launcher fail closed', async () => {
  for (const href of [`https://${'name:secret'}${'@'}www.csfd.cz/film/3-show/4-next/prehled/`, 'https://www.csfd.cz:8443/film/3-show/4-next/prehled/']) {
    const dom = page();
    const launcher = createLauncher(dom.window.document, apiWith({ status: 'ready', items: [{ seriesTitle: 'Unsafe', next: { href } }] }));
    await launcher.start();
    assert.equal(launcher.host(), null);
  }
});

test('opening a populated panel moves keyboard focus to its refresh action', async () => {
  const dom = page();
  const api = apiWith({ status: 'ready', items: [{
    seriesTitle: 'Show', next: { href: '/film/3-show/4-next/prehled/' }
  }] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  launcher.click();
  assert.equal(launcher.snapshot().focusedControl, 'refresh');
  launcher.stop();
});

test('launcher follows the cached language setting', async () => {
  const dom = page();
  const launcher = createLauncher(dom.window.document, apiWith({ status: 'ready', locale: 'sk', items: [{
    seriesTitle: 'Show', after: 'S01E01', next: { href: '/film/3-show/4-next/prehled/' }
  }] }));
  await launcher.start();
  launcher.click();
  const snapshot = launcher.snapshot();
  assert.equal(snapshot.locale, 'sk');
  assert.match(snapshot.refreshLabel, /Obnoviť/);
  assert.match(snapshot.rowDetails[0], /Naposledy/);
  launcher.stop();
});

test('a storage-only language change repaints the launcher', async () => {
  const dom = page();
  const state = { status: 'ready', locale: 'cs', items: [{ seriesTitle: 'Show', after: 'S01E01', next: { href: '/film/3-show/4-next/prehled/' } }] };
  const api = apiWith(state);
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  state.locale = 'en';
  api.fireStorage({ settings: { newValue: { locale: 'en' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launcher.snapshot().refreshLabel, '↻ Refresh');
  assert.match(launcher.snapshot().rowDetails[0], /Last rated/);
  launcher.stop();
});

test('page-panel language selector persists locally without refreshing ratings', async () => {
  const dom = page();
  const messages = [];
  let state = { status: 'ready', locale: 'cs', items: [] };
  const api = {
    runtime: { async sendMessage(message) {
      messages.push(message);
      if (message.type === 'locale') state = { ...state, locale: message.locale };
      return structuredClone(state);
    } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  launcher.click();
  await launcher.selectLocale('en');
  assert.deepEqual(messages, [{ type: 'state' }, { type: 'locale', locale: 'en' }]);
  assert.equal(launcher.snapshot().locale, 'en');
  assert.equal(launcher.snapshot().languageValue, 'en');
  assert.equal(launcher.snapshot().refreshLabel, '↻ Refresh');
  launcher.stop();
});

test('a delayed locale reply cannot overwrite a newer storage locale', async () => {
  const dom = page();
  let storageListener;
  let releaseLocale;
  const localeReply = new Promise((resolve) => { releaseLocale = resolve; });
  let current = { status: 'ready', locale: 'cs', items: [] };
  const api = {
    runtime: { async sendMessage(message) {
      if (message.type === 'locale') return localeReply;
      return structuredClone(current);
    } },
    storage: { onChanged: {
      addListener(fn) { storageListener = fn; }, removeListener() {}
    } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  const choosing = launcher.selectLocale('en');
  current = { ...current, locale: 'sk' };
  storageListener({ settings: { newValue: { locale: 'sk' } } }, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  releaseLocale({ ...current, locale: 'en' });
  await choosing;
  assert.equal(launcher.snapshot().locale, 'sk');
  assert.equal(launcher.snapshot().languageValue, 'sk');
  launcher.stop();
});

test('visible refresh status follows a later language change', async () => {
  const dom = page();
  let state = { status: 'ready', locale: 'cs', items: [] };
  const api = {
    runtime: { async sendMessage(message) {
      if (message.type === 'locale') state = { ...state, locale: message.locale };
      return structuredClone(state);
    } }, storage: { onChanged: { addListener() {}, removeListener() {} } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  await launcher.refresh();
  assert.equal(launcher.snapshot().refreshStatus, 'Hotovo.');
  await launcher.selectLocale('en');
  assert.equal(launcher.snapshot().refreshStatus, 'Done.');
  launcher.stop();
});

test('a failed locale save reports a settings error rather than a ratings refresh error', async () => {
  const dom = page();
  const api = {
    runtime: { async sendMessage(message) {
      if (message.type === 'locale') throw new Error('storage unavailable');
      return { status: 'ready', locale: 'en', items: [] };
    } }, storage: { onChanged: { addListener() {}, removeListener() {} } }
  };
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  await launcher.selectLocale('sk');
  assert.match(launcher.snapshot().refreshStatus, /language setting could not be saved/i);
  launcher.stop();
});

test('refresh reports returned failure state instead of claiming success', async () => {
  const dom = page();
  const api = apiWith({ status: 'network', locale: 'en', items: [] });
  const launcher = createLauncher(dom.window.document, api);
  await launcher.start();
  await launcher.refresh();
  assert.match(launcher.snapshot().refreshStatus, /could not be reached/i);
  launcher.stop();
});

test('an unavailable extension runtime leaves no misleading page control', async () => {
  const dom = page();
  const launcher = createLauncher(dom.window.document, { runtime: { async sendMessage() { throw new Error('gone'); } } });
  await launcher.start();
  assert.equal(launcher.host(), null);
  assert.equal(dom.window.document.querySelector('[data-dalsidil-launcher]'), null);
});
