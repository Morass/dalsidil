'use strict';
importScripts('model.js', 'parse.js', 'state.js', 'scan.js', 'profile.js');

const LEASE_MS = 3 * 60 * 1000;
const DEFAULT_COUNT = 10;
let refreshChain = Promise.resolve();
let settingsChain = Promise.resolve();
let accountGeneration = 0;
let creatingOffscreen = null;

async function ensureOffscreen() {
  const offscreenURL = chrome.runtime.getURL('offscreen/offscreen.html');
  const exists = chrome.runtime.getContexts
    ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenURL] })).length > 0
    : (await clients.matchAll()).some((client) => client.url === offscreenURL);
  if (exists) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Parse ČSFD pages locally without exposing account data.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function parsedPage(kind, url, extra) {
  const message = Object.assign({ target: 'offscreen', kind, url }, extra || {});
  try {
    await ensureOffscreen();
    try { return await chrome.runtime.sendMessage(message); }
    catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return await chrome.runtime.sendMessage(message);
    }
  } catch (_) {
    return { error: 'parser-unavailable' };
  }
}

const scanner = DalsiDilScan.createScanner({
  pagesPerRun: 5,
  pace: 700,
  loadRatings: (url, activity) => parsedPage('ratings', url, { activity }),
  loadEpisode: (url, seriesId) => parsedPage('episode', url, { seriesId })
});

const store = {
  async get(key) { return (await chrome.storage.local.get(key))[key]; },
  async set(key, value) { await chrome.storage.local.set({ [key]: value }); },
  async remove(key) { await chrome.storage.local.remove(key); }
};

function updateSettings(change) {
  const work = settingsChain.then(async () => {
    const current = await store.get('settings') || {};
    const next = change(Object.assign({}, current));
    await store.set('settings', next);
    return next;
  });
  settingsChain = work.catch(() => {});
  return work;
}

async function publicState() {
  const settings = await store.get('settings') || { count: DEFAULT_COUNT };
  const locale = ['cs', 'sk', 'en'].includes(settings.locale) ? settings.locale : 'cs';
  if (!settings.profile) return { status: 'setup', count: settings.count || DEFAULT_COUNT, locale, items: [], message: '' };
  const account = await store.get(DalsiDilState.accountKey(settings.profile.id)) || {};
  const items = account.items || [];
  const needsUpgrade = items.some((item) => !account.resolved || !account.resolved[item.seriesId] || account.resolved[item.seriesId].version !== DalsiDilScan.RESOLVER_VERSION);
  return {
    status: account.status || (account.items ? 'ready' : 'idle'),
    count: settings.count || DEFAULT_COUNT,
    locale,
    profile: settings.profile,
    items,
    needsUpgrade,
    partial: !!(account.scan && !account.scan.complete),
    page: account.scan && account.scan.nextPage,
    messageKey: account.messageKey || '',
    message: account.message || ''
  };
}

async function detectSignedInProfile() {
  const initial = await store.get('settings') || {};
  const preferred = initial.profile ? new URL(initial.profile.href).origin : 'https://www.csfd.cz';
  const origins = [preferred, 'https://www.csfd.cz', 'https://www.csfd.sk'].filter((value, index, all) => all.indexOf(value) === index);
  let uncertain = false;
  let signedOut = 0;
  for (const origin of origins) {
    try {
      const loaded = await parsedPage('profile', `${origin}/`);
      if (loaded.error) { uncertain = true; continue; }
      const found = loaded.parsed;
      if (found.state === 'unknown') uncertain = true;
      if (found.state === 'out') signedOut += 1;
      if (found.profile) {
        const current = await store.get('settings') || {};
        const changed = !current.profile || current.profile.id !== found.profile.id || current.profile.href !== found.profile.href;
        if (changed) accountGeneration += 1;
        await updateSettings((latest) => Object.assign(latest, { profile: found.profile, count: latest.count || DEFAULT_COUNT }));
        const state = await publicState();
        return { state, changed: changed || state.needsUpgrade };
      }
    } catch (_) { uncertain = true; }
  }
  if (!uncertain && signedOut === origins.length) {
    const current = await store.get('settings') || {};
    if (current.profile) {
      accountGeneration += 1;
      await store.remove(DalsiDilState.accountKey(current.profile.id));
    }
    await updateSettings((latest) => ({ count: latest.count || DEFAULT_COUNT, locale: ['cs', 'sk', 'en'].includes(latest.locale) ? latest.locale : 'cs' }));
    return { state: await publicState(), changed: !!current.profile };
  }
  const state = await publicState();
  if (state.profile) return { state: Object.assign({}, state, { message: '', messageKey: 'loginUnconfirmed' }), changed: false };
  state.messageKey = uncertain ? 'identifyFailed' : 'signedOut';
  return { state, changed: false };
}

async function refreshNow(full) {
  const generation = accountGeneration;
  const settings = await store.get('settings') || {};
  if (!settings.profile) return publicState();
  const key = DalsiDilState.accountKey(settings.profile.id);
  let account = await store.get(key) || {};
  const owner = crypto.randomUUID();
  const lease = DalsiDilState.acquireLease(account.lease, owner, Date.now(), LEASE_MS);
  if (!lease) {
    const wait = Math.max(1, Math.ceil((Number(account.lease && account.lease.until) - Date.now()) / 60000));
    await chrome.alarms.create('continue-scan', { delayInMinutes: wait });
    return publicState();
  }
  account.lease = lease;
  account.status = 'scanning';
  await store.set(key, account);
  if (generation !== accountGeneration) { await store.remove(key); return publicState(); }
  await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });

  const continuing = !full && account.scan && !account.scan.complete;
  const incremental = !full && !continuing && !!account.ratings;
  const resume = continuing
    ? { nextPage: account.scan.nextPage, ratings: account.scan.ratings, knownStreak: account.scan.knownStreak, activityBase: account.scan.activityBase, incremental: !!account.scan.incremental }
    : { nextPage: 1, ratings: (full ? {} : account.ratings || {}), incremental };
  const scanned = await scanner.scanRatings(settings.profile, resume, async (part) => {
    if (generation !== accountGeneration) throw new Error('account-changed');
    account = DalsiDilState.scanCheckpoint(account, part, Date.now());
    account.scan.incremental = incremental;
    account.scan.activityBase = part.activityBase;
    account.lease = { owner, until: Date.now() + LEASE_MS };
    await store.set(key, account);
    if (generation !== accountGeneration) { await store.remove(key); throw new Error('account-changed'); }
    await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });
  });

  if (generation !== accountGeneration) { await store.remove(key); return publicState(); }

  if (scanned.stopped && scanned.stopped !== 'chunk') {
    if (account.scan && !account.scan.complete) {
      await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });
    } else {
      await chrome.alarms.clear('continue-scan');
    }
    account.status = scanned.stopped;
    account.message = scanned.stopped === 'challenge' ? '' : `Refresh stopped: ${scanned.stopped}`;
    account.lease = null;
    await store.set(key, account);
    return publicState();
  }

  if (scanned.complete) {
    account = DalsiDilState.publishScan(account, { ratings: scanned.ratings, full: !!scanned.full }, Date.now());
  } else {
    account.scan = { complete: false, nextPage: scanned.nextPage, knownStreak: scanned.knownStreak, activityBase: scanned.activityBase, incremental, ratings: scanned.ratings, updatedAt: Date.now() };
  }
  const candidates = DalsiDilModel.rankedSeries(scanned.ratings);
  const resolved = await scanner.resolve(candidates, settings.count || DEFAULT_COUNT, account.resolved || {});
  account.resolved = resolved.cache;
  if (resolved.complete) account.items = resolved.items;
  account.status = resolved.stopped || (scanned.complete ? 'ready' : 'scanning');
  account.message = resolved.stopped && resolved.stopped !== 'challenge' ? `Refresh stopped: ${resolved.stopped}` : '';
  account.lease = null;
  await store.set(key, account);
  if (generation !== accountGeneration) { await store.remove(key); return publicState(); }
  if (scanned.complete) await chrome.alarms.clear('continue-scan');
  else await chrome.alarms.create('continue-scan', { delayInMinutes: 1 });
  return publicState();
}

function refresh(full) {
  const work = refreshChain.then(() => refreshNow(full)).catch(async (error) => {
    if (error && error.message === 'account-changed') return publicState();
    const settings = await store.get('settings') || {};
    if (!settings.profile) return { status: 'error', count: settings.count || DEFAULT_COUNT, items: [], message: '' };
    const key = DalsiDilState.accountKey(settings.profile.id);
    const account = await store.get(key) || {};
    account.status = 'error';
    account.message = '';
    account.lease = null;
    await store.set(key, account);
    await chrome.alarms.clear('continue-scan');
    return publicState();
  });
  refreshChain = work.catch(() => {});
  return work;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message && message.target === 'offscreen') return false;
  (async () => {
    if (message.type === 'state') return publicState();
    if (message.type === 'detect') return detectSignedInProfile();
    if (message.type === 'profile') {
      const profile = DalsiDilProfile.parseProfile(message.href);
      if (!profile) return Object.assign(await publicState(), { status: 'error', message: '', messageKey: 'invalidProfile' });
      const previous = await store.get('settings') || {};
      if (!previous.profile || previous.profile.id !== profile.id || previous.profile.href !== profile.href) accountGeneration += 1;
      await updateSettings((settings) => Object.assign(settings, { profile, count: settings.count || DEFAULT_COUNT }));
      return refresh(false);
    }
    if (message.type === 'count') {
      await updateSettings((settings) => Object.assign(settings, { count: Math.max(1, Math.min(25, Number(message.count) || DEFAULT_COUNT)) }));
      return refresh(false);
    }
    if (message.type === 'locale') {
      await updateSettings((settings) => Object.assign(settings, { locale: ['cs', 'sk', 'en'].includes(message.locale) ? message.locale : 'cs' }));
      return publicState();
    }
    if (message.type === 'refresh') return refresh(!!message.full);
    return publicState();
  })().then(respond, async () => {
    try { respond(Object.assign(await publicState(), { status: 'error', message: '' })); }
    catch (_) { respond({ status: 'error', count: DEFAULT_COUNT, items: [], message: '' }); }
  });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'continue-scan') return;
  (async () => {
    const settings = await store.get('settings') || {};
    if (!settings.profile) return;
    const account = await store.get(DalsiDilState.accountKey(settings.profile.id)) || {};
    if (account.lease && account.lease.until > Date.now()) {
      const wait = Math.max(1, Math.ceil((account.lease.until - Date.now()) / 60000));
      await chrome.alarms.create('continue-scan', { delayInMinutes: wait });
      return;
    }
    if (account.status === 'scanning' || (account.scan && !account.scan.complete)) await refresh(false);
  })();
});
