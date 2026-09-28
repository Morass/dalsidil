'use strict';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || message.target !== 'offscreen') return false;
  (async () => {
    const safe = DalsiDilParse.allowedFetchUrl(message.url, message.kind);
    if (!safe) return { error: 'invalid-url' };
    let response;
    try { response = await fetch(safe.href, { credentials: 'include', redirect: 'error' }); }
    catch (_) { return { error: 'network' }; }
    if (!response.ok) return { error: `http-${response.status}` };
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const base = doc.createElement('base');
    base.href = safe.href;
    (doc.head || doc.documentElement).prepend(base);
    if (message.kind === 'profile') return { parsed: DalsiDilProfile.detectProfile(doc, safe.href) };
    if (message.kind === 'ratings') return { parsed: DalsiDilParse.parseRatingsPage(doc, message.activity, safe.href) };
    if (message.kind === 'episode') return { parsed: DalsiDilParse.parseEpisodePage(doc, message.seriesId, safe.href) };
    return { error: 'unknown-parser-request' };
  })().then(respond, (error) => respond({ error: error.message }));
  return true;
});
