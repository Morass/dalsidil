(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.DalsiDilLauncher = api;
    if (root.document && root.chrome) api.createLauncher(root.document, root.chrome).start();
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const i18n = globalThis.DalsiDilI18n;

  const HOST_STYLE = [
    'all:initial!important', 'position:fixed!important', 'right:18px!important',
    'top:18px!important', 'z-index:2147483647!important',
    'display:block!important', 'width:auto!important', 'height:auto!important',
    'margin:0!important', 'padding:0!important', 'border:0!important',
    'visibility:visible!important', 'opacity:1!important', 'pointer-events:auto!important'
  ].join(';');

  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box}
    .wrap{position:relative;font:14px/1.4 system-ui,-apple-system,sans-serif;color:#eef1f3}
    button{border:0;color:#fff;font:700 14px/1 system-ui,-apple-system,sans-serif;cursor:pointer}
    button:disabled{opacity:.6;cursor:default}
    .launcher{display:block;margin-left:auto;border-radius:999px;padding:11px 16px;background:#d53b37;box-shadow:0 3px 14px #0007}
    .controls{display:flex;gap:8px;align-items:center;margin:12px 16px 0}
    .refresh{border-radius:6px;padding:9px 12px;background:#354c5d}
    select{min-width:112px;margin-left:auto;border:1px solid #65717a;border-radius:6px;padding:8px;background:#20262b;color:#fff;font:14px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}
    button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:2px}
    .panel{position:absolute;right:0;top:48px;width:min(360px,calc(100vw - 24px));max-height:min(480px,calc(100vh - 90px));overflow:auto;border:1px solid #4b555d;border-radius:10px;background:#15191d;box-shadow:0 7px 28px #0009}
    .panel[hidden]{display:none}
    h2{position:sticky;top:0;z-index:1;margin:0;padding:14px 16px;border-bottom:3px solid #d53b37;background:#20262b;font:700 18px/1.2 system-ui,-apple-system,sans-serif}
    p{margin:0;padding:14px 16px;color:#c3ccd1}
    .refresh-status{padding:10px 16px 0;color:#c3ccd1}
    .refresh-status[hidden]{display:none}
    ol{list-style:none;margin:0;padding:0 16px}
    li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;padding:12px 0;border-bottom:1px solid #343b41}
    strong{overflow-wrap:anywhere;font-weight:700}
    small{grid-column:1;color:#95a1a8}
    a{grid-column:2;grid-row:1/3;align-self:center;max-width:145px;border-radius:6px;padding:7px 9px;background:#354c5d;color:#fff;text-align:center;text-decoration:none}
  `;

  function createLauncher(doc, chromeApi) {
    let currentHost = null;
    let shadow = null;
    let button = null;
    let panel = null;
    let list = null;
    let note = null;
    let refreshButton = null;
    let languageSelect = null;
    let refreshStatus = null;
    let refreshInFlight = null;
    let state = { status: 'setup', items: [] };
    let documentObserver = null;
    let rootObserver = null;
    let observedRoot = null;
    let stopped = false;
    let available = false;
    let paintedState = '';
    let readGeneration = 0;

    function linkFor(item) {
      const url = new URL(item.next.href, item.next.host || item.host || doc.location.origin);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !['www.csfd.cz', 'www.csfd.sk'].includes(url.hostname)) {
        throw new Error('invalid cached link');
      }
      return url.href;
    }

    function validateState(next) {
      if (!next || !Array.isArray(next.items)) throw new Error('invalid cached state');
      for (const item of next.items) {
        if (!item || !item.next || typeof item.next.href !== 'string') throw new Error('invalid cached item');
        linkFor(item);
      }
      return next;
    }

    function acceptState(next) {
      validateState(next);
      const nextPaintedState = JSON.stringify([next.status, next.locale, next.items]);
      state = next;
      available = true;
      if (nextPaintedState !== paintedState) {
        paintedState = nextPaintedState;
        repaint();
      }
    }

    function repaint() {
      if (!currentHost || !button || !panel || !list || !note) return;
      const items = state.items || [];
      const locale = i18n.locale(state.locale);
      currentHost.setAttribute('lang', locale);
      button.textContent = items.length ? `Další díl · ${items.length}` : 'Další díl';
      button.setAttribute('aria-label', items.length ? `Další díl, ${i18n.t(locale, 'items', { count: items.length })}` : 'Další díl');
      refreshButton.textContent = `↻ ${i18n.t(locale, 'refresh')}`;
      languageSelect.setAttribute('aria-label', i18n.t(locale, 'language'));
      languageSelect.value = locale;
      list.textContent = '';
      for (const item of items) {
        if (!item || !item.next || !item.next.href) continue;
        const row = doc.createElement('li');
        const title = doc.createElement('strong');
        const detail = doc.createElement('small');
        const link = doc.createElement('a');
        title.textContent = item.seriesTitle || i18n.t(locale, 'series');
        detail.textContent = item.after ? `${i18n.t(locale, 'lastRated')}: ${item.after}` : i18n.t(locale, 'nextEpisode');
        link.href = linkFor(item);
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = item.next.code
          ? `${item.next.code}${item.next.title ? ` · ${item.next.title}` : ''}`
          : (item.next.title || i18n.t(locale, 'openNext'));
        row.append(title, detail, link);
        list.appendChild(row);
      }
      note.hidden = list.children.length > 0;
      note.textContent = state.status === 'setup'
        ? i18n.t(locale, 'launcherSetup')
        : i18n.t(locale, 'launcherEmpty');
    }

    function buildHost() {
      const host = doc.createElement('div');
      host.dataset.dalsidilLauncher = '';
      host.setAttribute('style', HOST_STYLE);
      const root = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = CSS;
      const wrap = doc.createElement('div');
      wrap.className = 'wrap';
      const nextPanel = doc.createElement('section');
      nextPanel.className = 'panel';
      nextPanel.hidden = true;
      nextPanel.setAttribute('aria-label', 'Další díl');
      const heading = doc.createElement('h2');
      heading.textContent = 'Další díl';
      const nextNote = doc.createElement('p');
      const nextRefreshStatus = doc.createElement('p');
      nextRefreshStatus.className = 'refresh-status';
      nextRefreshStatus.setAttribute('role', 'status');
      nextRefreshStatus.hidden = true;
      const nextList = doc.createElement('ol');
      const nextButton = doc.createElement('button');
      nextButton.className = 'launcher';
      nextButton.type = 'button';
      nextButton.setAttribute('aria-expanded', 'false');
      nextButton.addEventListener('click', () => {
        const open = nextPanel.hidden;
        nextPanel.hidden = !open;
        nextButton.setAttribute('aria-expanded', String(open));
        if (open) nextRefreshButton.focus();
      });
      const nextRefreshButton = doc.createElement('button');
      nextRefreshButton.className = 'refresh';
      nextRefreshButton.type = 'button';
      nextRefreshButton.textContent = '↻';
      nextRefreshButton.addEventListener('click', () => { refresh(); });
      const controls = doc.createElement('div');
      controls.className = 'controls';
      const nextLanguageSelect = doc.createElement('select');
      for (const [value, label] of [['cs', 'Čeština'], ['sk', 'Slovenčina'], ['en', 'English']]) {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = label;
        nextLanguageSelect.appendChild(option);
      }
      nextLanguageSelect.addEventListener('change', () => { setLocale(nextLanguageSelect.value); });
      controls.append(nextRefreshButton, nextLanguageSelect);
      nextPanel.append(heading, nextRefreshStatus, controls, nextNote, nextList);
      wrap.append(nextButton, nextPanel);
      root.append(style, wrap);
      currentHost = host;
      shadow = root;
      button = nextButton;
      panel = nextPanel;
      list = nextList;
      note = nextNote;
      refreshButton = nextRefreshButton;
      languageSelect = nextLanguageSelect;
      refreshStatus = nextRefreshStatus;
      repaint();
      return host;
    }

    function ensureAttached() {
      if (stopped || !available || !doc.documentElement) return;
      for (const orphan of doc.querySelectorAll('[data-dalsidil-launcher]')) {
        if (orphan !== currentHost) orphan.remove();
      }
      if (!(currentHost && currentHost.isConnected && currentHost.parentNode === doc.documentElement)) {
        if (currentHost && currentHost.isConnected) currentHost.remove();
        doc.documentElement.appendChild(buildHost());
      }
      if (observedRoot !== doc.documentElement) {
        if (rootObserver) rootObserver.disconnect();
        observedRoot = doc.documentElement;
        rootObserver = new doc.defaultView.MutationObserver(ensureAttached);
        rootObserver.observe(observedRoot, { childList: true });
      }
    }

    async function readCachedState() {
      const generation = ++readGeneration;
      try {
        const next = await chromeApi.runtime.sendMessage({ type: 'state' });
        validateState(next);
        if (generation !== readGeneration) return false;
        acceptState(next);
        return true;
      } catch (error) {
        if (generation !== readGeneration) return false;
        throw error;
      }
    }

    function refresh() {
      if (refreshInFlight) return refreshInFlight;
      refreshButton.disabled = true;
      refreshStatus.hidden = false;
      const locale = i18n.locale(state.locale);
      refreshStatus.textContent = i18n.t(locale, 'refreshing');
      const work = (async () => {
        try {
          const next = validateState(await chromeApi.runtime.sendMessage({ type: 'refresh', full: false }));
          readGeneration += 1;
          acceptState(next);
          ensureAttached();
          const nextLocale = i18n.locale(next.locale);
          refreshStatus.textContent = next.status === 'scanning'
            ? i18n.t(nextLocale, 'background')
            : next.status === 'challenge' ? i18n.t(nextLocale, 'challenge')
              : next.status === 'network' ? i18n.t(nextLocale, 'network')
                : /^http-/.test(next.status || '') ? i18n.t(nextLocale, 'httpError', { code: next.status.slice(5) })
                  : next.status === 'ready' ? i18n.t(nextLocale, 'done') : i18n.t(nextLocale, 'refreshFailed');
        } catch (_) {
          refreshStatus.textContent = i18n.t(locale, 'refreshFailed');
        } finally {
          refreshButton.disabled = false;
          refreshInFlight = null;
        }
      })();
      refreshInFlight = work;
      return work;
    }

    async function setLocale(locale) {
      const requested = i18n.locale(locale);
      if (!languageSelect || languageSelect.disabled) return;
      languageSelect.disabled = true;
      try {
        const next = validateState(await chromeApi.runtime.sendMessage({ type: 'locale', locale: requested }));
        readGeneration += 1;
        acceptState(next);
        ensureAttached();
      } catch (_) {
        languageSelect.value = i18n.locale(state.locale);
        refreshStatus.hidden = false;
        refreshStatus.textContent = i18n.t(i18n.locale(state.locale), 'refreshFailed');
      } finally {
        languageSelect.disabled = false;
      }
    }

    function onStorageChanged(_changes, area) {
      if (area !== 'local' || stopped) return;
      readCachedState().then((current) => { if (current) ensureAttached(); }).catch(() => {
        available = false;
        if (currentHost) currentHost.remove();
        currentHost = null;
      });
    }

    async function start() {
      try {
        if (chromeApi.storage && chromeApi.storage.onChanged) chromeApi.storage.onChanged.addListener(onStorageChanged);
        const current = await readCachedState();
        if (stopped) return;
        if (current) ensureAttached();
        documentObserver = new doc.defaultView.MutationObserver(ensureAttached);
        documentObserver.observe(doc, { childList: true });
      } catch (_) {
        available = false;
        if (currentHost) currentHost.remove();
        currentHost = null;
      }
    }

    function stop() {
      stopped = true;
      if (documentObserver) documentObserver.disconnect();
      if (rootObserver) rootObserver.disconnect();
      if (chromeApi.storage && chromeApi.storage.onChanged) chromeApi.storage.onChanged.removeListener(onStorageChanged);
      if (currentHost) currentHost.remove();
      currentHost = null;
    }

    return {
      start, stop, refresh, selectLocale: setLocale,
      host: () => currentHost,
      click: () => { if (button) button.click(); },
      focusFirstLink: () => { const link = list && list.querySelector('a'); if (link) link.focus(); },
      focusedLink: () => shadow && shadow.activeElement && shadow.activeElement.tagName === 'A' ? shadow.activeElement.href : null,
      snapshot: () => ({
        locale: i18n.locale(state.locale),
        open: !!(panel && !panel.hidden),
        focusedControl: shadow && shadow.activeElement === refreshButton ? 'refresh' : null,
        refreshDisabled: !!(refreshButton && refreshButton.disabled),
        refreshStatus: refreshStatus ? refreshStatus.textContent : '',
        refreshLabel: refreshButton ? refreshButton.textContent : '',
        languageValue: languageSelect ? languageSelect.value : '',
        rowDetails: list ? [...list.children].map((row) => row.querySelector('small').textContent) : [],
        rows: list ? [...list.children].map((row) => ({
          title: row.querySelector('strong').textContent,
          href: row.querySelector('a').href
        })) : []
      })
    };
  }

  return { createLauncher };
});
