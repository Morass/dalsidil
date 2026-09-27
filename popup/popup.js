(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilPopup = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const messages = {
    challenge: 'ČSFD blocked the refresh. Open ČSFD in a tab, complete its check, then refresh here.',
    network: 'ČSFD could not be reached. Cached results are shown below.',
    'parser-unavailable': 'ČSFD parser unavailable. Close and reopen the extension, then try again.',
    detecting: 'Checking which ČSFD account is signed in…',
    resolving: 'Finding the following episodes and their names…',
    setup: 'Sign in to ČSFD, or add your profile URL in Settings.',
    idle: 'Account found. Starting the first scan…',
    error: 'Something unexpected failed. Reopen the extension and try again.',
    ready: '',
    empty: 'No unfinished rated series found yet.'
  };

  function statusMessage(state) {
    if (/^http-\d+$/.test(state.status || '')) return `ČSFD returned error ${state.status.slice(5)}. Cached results are shown below.`;
    if (messages[state.status] != null) return messages[state.status];
    if (state.message) return state.message;
    return state.status ? `Refresh stopped: ${state.status}. Try again.` : '';
  }

  function render(doc, state) {
    const status = doc.querySelector('#status');
    const list = doc.querySelector('#results');
    list.textContent = '';
    const items = state.items || [];
    let note = statusMessage(state);
    if (state.status === 'scanning') note = `Still scanning your ratings — page ${state.page || 1}. Cached results stay usable.`;
    if (state.status === 'ready' && !items.length) note = messages.empty;
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
      detail.textContent = `Last rated: ${item.after || 'your latest episode rating'}`;
      const link = doc.createElement('a');
      link.href = new URL(item.next.href, item.next.host || item.host || 'https://www.csfd.cz/').href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = item.next.code ? `${item.next.code}${item.next.title ? ` · ${item.next.title}` : ''}` : (item.next.title || 'Open next →');
      row.append(title, detail, link);
      list.appendChild(row);
    }
  }

  async function start(doc, api) {
    const count = doc.querySelector('#count');
    const profile = doc.querySelector('#profile');
    const refresh = doc.querySelector('#refresh');
    const fullRefresh = doc.querySelector('#full-refresh');
    let saved = { status: 'detecting', count: 10, items: [] };
    const isBusy = (state) => ['detecting', 'scanning', 'resolving'].includes(state && state.status);
    const schedule = api.schedule || ((fn) => setTimeout(fn, 1500));
    const watchBusy = () => {
      if (!isBusy(saved)) return;
      schedule(async () => {
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
    catch (error) { render(doc, { status: 'error', items: [], message: error.message }); return; }
    count.value = saved.count || 10;
    profile.value = saved.profile && saved.profile.href || '';
    render(doc, Object.assign({}, saved, { status: 'detecting', message: '' }));
    let detected;
    try { detected = await api.send({ type: 'detect' }); }
    catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); return; }
    if (!detected || !detected.state) {
      render(doc, Object.assign({}, saved, { status: 'error', message: '' }));
      return;
    }
    saved = detected.state;
    profile.value = saved.profile && saved.profile.href || '';
    render(doc, saved);
    if (detected.changed || saved.status === 'idle') {
      render(doc, Object.assign({}, saved, { status: 'scanning', page: saved.page || 1 }));
      try { saved = await api.send({ type: 'refresh', full: false }); render(doc, saved); }
      catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); }
    }
    watchBusy();
    count.addEventListener('change', async () => {
      render(doc, Object.assign({}, saved, { status: 'resolving' }));
      try { saved = await api.send({ type: 'count', count: Number(count.value) }); render(doc, saved); }
      catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); }
    });
    profile.addEventListener('change', async () => {
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'profile', href: profile.value }); render(doc, saved); }
      catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); }
    });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'refresh', full: false }); render(doc, saved); }
      catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); }
      finally { refresh.disabled = false; }
    });
    fullRefresh.addEventListener('click', async () => {
      fullRefresh.disabled = true;
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { saved = await api.send({ type: 'refresh', full: true }); render(doc, saved); }
      catch (error) { render(doc, Object.assign({}, saved, { status: 'error', message: error.message })); }
      finally { fullRefresh.disabled = false; }
    });
  }

  return { render, start };
});
