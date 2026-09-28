(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilPopup = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const i18n = globalThis.DalsiDilI18n;
  const statusKeys = { challenge: 'challenge', network: 'network', 'parser-unavailable': 'parserUnavailable', detecting: 'detecting', resolving: 'resolving', setup: 'setup', idle: 'idle', error: 'error' };
  const language = (state) => i18n.locale(state && state.locale);

  function statusMessage(state) {
    const locale = language(state);
    if (state.message && !/^Refresh stopped:/.test(state.message)) return state.message;
    if (/^http-\d+$/.test(state.status || '')) return i18n.t(locale, 'httpError', { code: state.status.slice(5) });
    if (statusKeys[state.status]) return i18n.t(locale, statusKeys[state.status]);
    if (state.status === 'ready') return '';
    if (state.message) return state.message;
    return state.status ? i18n.t(locale, 'stopped', { status: state.status }) : '';
  }

  function localize(doc, locale) {
    doc.documentElement.lang = locale;
    const values = { '#subtitle': 'subtitle', '#profile-label': 'profile', '#count-label': 'count', '#language-label': 'language', '#privacy': 'privacy' };
    for (const [selector, key] of Object.entries(values)) {
      const element = doc.querySelector(selector);
      if (element) element.textContent = i18n.t(locale, key);
    }
    const summary = doc.querySelector('#setup summary');
    if (summary) summary.textContent = i18n.t(locale, 'settings');
    const refresh = doc.querySelector('#refresh');
    if (refresh) {
      refresh.title = i18n.t(locale, 'refresh');
      refresh.setAttribute('aria-label', i18n.t(locale, 'refresh'));
    }
    const full = doc.querySelector('#full-refresh');
    if (full) full.textContent = i18n.t(locale, 'fullRefresh');
  }

  function render(doc, state) {
    const locale = language(state);
    localize(doc, locale);
    const status = doc.querySelector('#status');
    const list = doc.querySelector('#results');
    list.textContent = '';
    const items = state.items || [];
    let note = statusMessage(state);
    if (state.status === 'scanning') note = i18n.t(locale, 'scanning', { page: state.page || 1 });
    if (state.status === 'ready' && !items.length && !note) note = i18n.t(locale, 'empty');
    status.textContent = note;
    status.hidden = !note;
    const busy = ['detecting', 'scanning', 'resolving'].includes(state.status);
    status.dataset.busy = busy ? 'true' : 'false';
    doc.querySelector('main').setAttribute('aria-busy', String(busy));
    list.hidden = state.status === 'challenge' && !items.length;
    for (const item of items) {
      const row = doc.createElement('li');
      const title = doc.createElement('strong');
      title.textContent = item.seriesTitle;
      const detail = doc.createElement('small');
      detail.textContent = `${i18n.t(locale, 'lastRated')}: ${item.after || i18n.t(locale, 'latestRating')}`;
      const link = doc.createElement('a');
      link.href = new URL(item.next.href, item.next.host || item.host || 'https://www.csfd.cz/').href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = item.next.code ? `${item.next.code}${item.next.title ? ` · ${item.next.title}` : ''}` : (item.next.title || i18n.t(locale, 'openNext'));
      row.append(title, detail, link);
      list.appendChild(row);
    }
  }

  async function start(doc, api) {
    const count = doc.querySelector('#count');
    const profile = doc.querySelector('#profile');
    const refresh = doc.querySelector('#refresh');
    const fullRefresh = doc.querySelector('#full-refresh');
    const localeSelect = doc.querySelector('#locale');
    let saved = { status: 'detecting', count: 10, items: [] };
    const isBusy = (state) => ['detecting', 'scanning', 'resolving'].includes(state && state.status);
    const schedule = api.schedule || ((fn) => setTimeout(fn, 1500));
    let pollScheduled = false;
    const watchBusy = () => {
      if (!isBusy(saved) || pollScheduled) return;
      pollScheduled = true;
      schedule(async () => {
        pollScheduled = false;
        try {
          saved = await api.send({ type: 'state' });
          render(doc, saved);
          watchBusy();
        } catch (_) {
          render(doc, Object.assign({}, saved, { status: 'error', message: '' }));
        }
      });
    };
    render(doc, saved);
    try { saved = await api.send({ type: 'state' }); }
    catch (_) { render(doc, { status: 'error', items: [], message: '' }); return; }
    count.value = saved.count || 10;
    profile.value = saved.profile && saved.profile.href || '';
    if (localeSelect) localeSelect.value = language(saved);
    render(doc, Object.assign({}, saved, { status: 'detecting', message: '' }));
    let detected;
    try { detected = await api.send({ type: 'detect' }); }
    catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); return; }
    if (!detected || !detected.state) {
      render(doc, Object.assign({}, saved, { status: 'error', message: '' }));
      return;
    }
    saved = detected.state;
    profile.value = saved.profile && saved.profile.href || '';
    if (localeSelect) localeSelect.value = language(saved);
    render(doc, saved);
    if (detected.changed || saved.status === 'idle') {
      render(doc, Object.assign({}, saved, { status: 'scanning', page: saved.page || 1 }));
      try { saved = await api.send({ type: 'refresh', full: false }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
    }
    watchBusy();
    count.addEventListener('change', async () => {
      render(doc, Object.assign({}, saved, { status: 'resolving' }));
      try { saved = await api.send({ type: 'count', count: Number(count.value) }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
      watchBusy();
    });
    if (localeSelect) localeSelect.addEventListener('change', async () => {
      const requested = i18n.locale(localeSelect.value);
      saved = Object.assign({}, saved, { locale: requested });
      render(doc, saved);
      try { saved = await api.send({ type: 'locale', locale: requested }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
    });
    profile.addEventListener('change', async () => {
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'profile', href: profile.value }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
      watchBusy();
    });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'refresh', full: false }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
      finally { refresh.disabled = false; }
      watchBusy();
    });
    fullRefresh.addEventListener('click', async () => {
      fullRefresh.disabled = true;
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'refresh', full: true }); render(doc, saved); }
      catch (_) { render(doc, Object.assign({}, saved, { status: 'error', message: '' })); }
      finally { fullRefresh.disabled = false; }
      watchBusy();
    });
  }

  return { render, start, localize };
});
