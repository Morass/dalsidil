'use strict';
importScripts('model.js', 'parse.js', 'state.js', 'scan.js');

const LEASE_MS = 3 * 60 * 1000;
const DEFAULT_COUNT = 10;
const BOOT_ID = crypto.randomUUID();
const scanner = DalsiDilScan.createScanner({ pagesPerRun: 5, pace: 700 });
let refreshChain = Promise.resolve();

const store = {
  async get(key) { return (await chrome.storage.local.get(key))[key]; },
  async set(key, value) { await chrome.storage.local.set({ [key]: value }); }
};

function parseProfile(href) {
  let url;
  try { url = new URL(href); } catch (_) { return null; }
  if (url.protocol !== 'https:' || !['www.csfd.cz', 'www.csfd.sk'].includes(url.hostname)) return null;
  const match = /^\/(?:en\/)?(?:uzivatel|user)\/(\d+)-[^/]+\//.exec(url.pathname);
  if (!match) return null;
  const prefix = url.pathname.startsWith('/en/') ? '/en/user/' : (url.hostname.endsWith('.sk') ? '/uzivatel/' : '/uzivatel/');
  const slug = url.pathname.split('/')[url.pathname.startsWith('/en/') ? 3 : 2];
  return { id: Number(match[1]), href: `${url.origin}${prefix}${slug}/` };
}

async function publicState() {
  const settings = await store.get('settings') || { count: DEFAULT_COUNT };
  if (!settings.profile) return { status: 'setup', count: settings.count || DEFAULT_COUNT, items: [], message: 'Add your ČSFD profile URL to begin.' };
  const account = await store.get(DalsiDilState.accountKey(settings.profile.id)) || {};
  return {
    status: account.status || (account.items ? 'ready' : 'idle'),
    count: settings.count || DEFAULT_COUNT,
    profile: settings.profile,
    items: account.items || [],
    partial: !!(account.scan && !account.scan.complete),
    page: account.scan && account.scan.nextPage,
    message: account.message || ''
  };
}

async function refreshNow(full) {
  const settings = await store.get('settings') || {};
  if (!settings.profile) return publicState();
  const key = DalsiDilState.accountKey(settings.profile.id);
  let account = await store.get(key) || {};
  const owner = `${BOOT_ID}:${crypto.randomUUID()}`;
  if (account.lease && !String(account.lease.owner || '').startsWith(`${BOOT_ID}:`)) account.lease = null;
  const lease = DalsiDilState.acquireLease(account.lease, owner, Date.now(), LEASE_MS);
  if (!lease) return publicState();
  account.lease = lease;
  account.status = 'scanning';
  await store.set(key, account);

  const continuing = account.scan && !account.scan.complete;
  const incremental = !full && !continuing && !!account.ratings;
  const resume = continuing
    ? { nextPage: account.scan.nextPage, ratings: account.scan.ratings, knownStreak: account.scan.knownStreak, incremental: !!account.scan.incremental }
    : { nextPage: 1, ratings: (full ? {} : account.ratings || {}), incremental };
  const scanned = await scanner.scanRatings(settings.profile, resume, async (part) => {
    account = DalsiDilState.scanCheckpoint(account, part, Date.now());
    account.scan.incremental = incremental;
    account.lease = { owner, until: Date.now() + LEASE_MS };
    await store.set(key, account);
    await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });
  });

  if (scanned.stopped && scanned.stopped !== 'chunk') {
    await chrome.alarms.clear('continue-scan');
    account.status = scanned.stopped;
    account.message = scanned.stopped === 'challenge' ? '' : `Refresh stopped: ${scanned.stopped}`;
    account.lease = null;
    await store.set(key, account);
    return publicState();
  }

  if (scanned.complete) {
    await chrome.alarms.clear('continue-scan');
    account = DalsiDilState.publishScan(account, { ratings: scanned.ratings, full: !!scanned.full }, Date.now());
  } else {
    account.scan = { complete: false, nextPage: scanned.nextPage, knownStreak: scanned.knownStreak, incremental, ratings: scanned.ratings, updatedAt: Date.now() };
  }
  const candidates = DalsiDilModel.rankedSeries(scanned.ratings);
  const resolved = await scanner.resolve(candidates, settings.count || DEFAULT_COUNT, account.resolved || {});
  account.resolved = resolved.cache;
  if (resolved.complete) account.items = resolved.items;
  account.status = resolved.stopped || (scanned.complete ? 'ready' : 'scanning');
  account.message = resolved.stopped && resolved.stopped !== 'challenge' ? `Refresh stopped: ${resolved.stopped}` : '';
  account.lease = null;
  await store.set(key, account);
  if (!scanned.complete) await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });
  return publicState();
}

function refresh(full) {
  const work = refreshChain.then(() => refreshNow(full));
  refreshChain = work.catch(() => {});
  return work;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  (async () => {
    if (message.type === 'state') return publicState();
    if (message.type === 'profile') {
      const profile = parseProfile(message.href);
      if (!profile) return Object.assign(await publicState(), { status: 'error', message: 'That is not a ČSFD profile URL.' });
      const settings = await store.get('settings') || {};
      await store.set('settings', Object.assign({}, settings, { profile, count: settings.count || DEFAULT_COUNT }));
      return refresh(false);
    }
    if (message.type === 'count') {
      const settings = await store.get('settings') || {};
      settings.count = Math.max(1, Math.min(25, Number(message.count) || DEFAULT_COUNT));
      await store.set('settings', settings);
      return refresh(false);
    }
    if (message.type === 'refresh') return refresh(!!message.full);
    return publicState();
  })().then(respond, (error) => respond({ status: 'error', items: [], message: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'continue-scan') refresh(false);
});
