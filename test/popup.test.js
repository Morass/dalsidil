const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { render, start } = require('../popup/popup.js');

const page = () => new JSDOM('<main><p id="status"></p><ol id="results"></ol><section id="setup"><input id="profile"></section></main>').window.document;

test('blocked state is visible and is not rendered as an empty finished list', () => {
  const doc = page();
  render(doc, { status: 'challenge', items: [] });
  assert.match(doc.querySelector('#status').textContent, /ČSFD.*blocked/i);
  assert.equal(doc.querySelector('#results').hidden, true);
});

test('results link to the next episode and explain progress', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Columbo', next: { href: '/film/1-show/2-next/prehled/', title: 'Next', code: 'S05E02' }, after: 'S05E01' }] });
  const row = doc.querySelector('li');
  assert.match(row.textContent, /Columbo/);
  assert.match(row.textContent, /after S05E01/i);
  assert.match(row.querySelector('a').href, /2-next/);
});

test('a next episode parsed from sk links back to sk', () => {
  const doc = page();
  render(doc, { status: 'ready', items: [{ seriesTitle: 'Show', next: { href: '/film/1-show/2-next/prehled/', host: 'https://www.csfd.sk', title: 'Next' } }] });
  assert.equal(doc.querySelector('a').origin, 'https://www.csfd.sk');
});

test('an incomplete first scan is named as partial rather than complete', () => {
  const doc = page();
  render(doc, { status: 'scanning', partial: true, page: 6, items: [] });
  assert.match(doc.querySelector('#status').textContent, /still scanning.*page 6/i);
});

function startupPage() {
  return new JSDOM('<p id="status"></p><ol id="results"></ol><input id="count"><input id="profile"><button id="refresh"></button><button id="full-refresh"></button>').window.document;
}

test('startup scans after discovering a different signed-in account', async () => {
  const calls = [];
  const api = { async send(message) {
    calls.push(message);
    if (message.type === 'state') return { status: 'setup', count: 10, items: [] };
    if (message.type === 'detect') return { changed: true, state: { status: 'idle', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] } };
    return { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  } };
  await start(startupPage(), api);
  assert.deepEqual(calls.map((call) => call.type), ['state', 'detect', 'refresh']);
});

test('startup does not rescan when the active signed-in account is unchanged', async () => {
  const calls = [];
  const state = { status: 'ready', count: 10, profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' }, items: [] };
  await start(startupPage(), { async send(message) {
    calls.push(message);
    return message.type === 'detect' ? { changed: false, state } : state;
  } });
  assert.deepEqual(calls.map((call) => call.type), ['state', 'detect']);
});
