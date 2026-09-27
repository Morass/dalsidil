(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilProfile = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const HOSTS = new Set(['www.csfd.cz', 'www.csfd.sk']);
  const PATH = /^\/(?:en\/)?(?:uzivatel|user)\/(\d+)-([^/?#]+)(?:\/|$)/;

  function parseProfile(href, base) {
    let url;
    try { url = new URL(href, base); } catch (_) { return null; }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
    const match = PATH.exec(url.pathname);
    if (!match) return null;
    const prefix = url.pathname.startsWith('/en/') ? '/en/user/' : '/uzivatel/';
    return { id: Number(match[1]), href: `${url.origin}${prefix}${match[1]}-${match[2]}/` };
  }

  function loginFlag(doc) {
    const header = doc.querySelector('header.page-header, .page-header');
    if (!header) return null;
    const classes = ` ${String(header.className || '')} `;
    if (classes.includes(' user-not-logged ')) return false;
    if (classes.includes(' user-logged ')) return true;
    return null;
  }

  function detectProfile(doc, baseURL) {
    if (loginFlag(doc) === false) return { state: 'out', profile: null };
    const base = baseURL || doc.baseURI;
    const links = doc.querySelectorAll('.header-bar a.profile[href*="/uzivatel/"], .header-bar a.profile[href*="/user/"]');
    for (const link of links) {
      const profile = parseProfile(link.getAttribute('href'), base);
      if (profile) return { state: 'in', profile };
    }
    return { state: loginFlag(doc) === true ? 'unknown' : 'out', profile: null };
  }

  return { parseProfile, detectProfile };
});
