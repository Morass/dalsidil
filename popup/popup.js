(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilPopup = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const messages = {
    challenge: 'ČSFD blocked the refresh. Open ČSFD in a tab, complete its check, then refresh here.',
    network: 'ČSFD could not be reached. Cached results are shown below.',
    ready: '',
    empty: 'No unfinished rated series found yet.'
  };

  function render(doc, state) {
    const status = doc.querySelector('#status');
    const list = doc.querySelector('#results');
    list.textContent = '';
    const items = state.items || [];
    let note = messages[state.status] || state.message || '';
    if (state.status === 'scanning') note = `Still scanning your ratings — page ${state.page || 1}. Cached results stay usable.`;
    if (state.status === 'ready' && !items.length) note = messages.empty;
    status.textContent = note;
    status.hidden = !note;
    list.hidden = state.status === 'challenge' && !items.length;
    for (const item of items) {
      const row = doc.createElement('li');
      const title = doc.createElement('strong');
      title.textContent = item.seriesTitle;
      const detail = doc.createElement('small');
      detail.textContent = `after ${item.after || 'your last rated episode'}`;
      const link = doc.createElement('a');
      link.href = new URL(item.next.href, item.host || 'https://www.csfd.cz/').href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = item.next.code ? `${item.next.code}${item.next.title ? ` · ${item.next.title}` : ''}` : (item.next.title || 'Next episode');
      row.append(title, detail, link);
      list.appendChild(row);
    }
  }

  async function start(doc, api) {
    const count = doc.querySelector('#count');
    const profile = doc.querySelector('#profile');
    const refresh = doc.querySelector('#refresh');
    const fullRefresh = doc.querySelector('#full-refresh');
    const saved = await api.send({ type: 'state' });
    count.value = saved.count || 10;
    profile.value = saved.profile && saved.profile.href || '';
    render(doc, saved);
    count.addEventListener('change', async () => render(doc, await api.send({ type: 'count', count: Number(count.value) })));
    profile.addEventListener('change', async () => render(doc, await api.send({ type: 'profile', href: profile.value })));
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      render(doc, Object.assign({}, saved, { status: 'scanning', page: 1 }));
      try { render(doc, await api.send({ type: 'refresh', full: false })); }
      finally { refresh.disabled = false; }
    });
    fullRefresh.addEventListener('click', async () => {
      fullRefresh.disabled = true;
      try { render(doc, await api.send({ type: 'refresh', full: true })); }
      finally { fullRefresh.disabled = false; }
    });
  }

  return { render, start };
});
