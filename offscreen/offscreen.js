'use strict';

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || message.target !== 'offscreen') return false;
  (async () => {
    let response;
    try { response = await fetch(message.url, { credentials: 'include', redirect: 'error' }); }
    catch (_) { return { error: 'network' }; }
    if (!response.ok) return { error: `http-${response.status}` };
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const base = doc.createElement('base');
    base.href = message.url;
    (doc.head || doc.documentElement).prepend(base);
    if (message.kind === 'profile') return { parsed: DalsiDilProfile.detectProfile(doc, message.url) };
    if (message.kind === 'ratings') return { parsed: DalsiDilParse.parseRatingsPage(doc, message.activity, message.url) };
    if (message.kind === 'episode') return { parsed: DalsiDilParse.parseEpisodePage(doc, message.seriesId, message.url) };
    return { error: 'unknown-parser-request' };
  })().then(respond, (error) => respond({ error: error.message }));
  return true;
});
