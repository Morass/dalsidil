const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function parserHarness(body) {
  let listener;
  let request;
  const context = vm.createContext({
    URL,
    DOMParser: new JSDOM('', { url: 'chrome-extension://test/offscreen/offscreen.html' }).window.DOMParser,
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => body };
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }
  });
  context.globalThis = context;
  const root = path.resolve(__dirname, '..');
  for (const file of ['src/parse.js', 'src/profile.js', 'offscreen/offscreen.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return {
    send(message) { return new Promise((resolve) => listener(message, {}, resolve)); },
    get request() { return request; }
  };
}

test('real offscreen parser uses the fetched sk URL as the base for relative links', async () => {
  const html = '<table><tr><td class="name"><a class="film-title-name" href="/film/9-show/11-one/prehled/">One</a> (S01E01)</td><td><span class="stars stars-4"></span></td></tr></table>';
  const app = parserHarness(html);
  const result = await app.send({ target: 'offscreen', kind: 'ratings', url: 'https://www.csfd.sk/uzivatel/7-me/hodnoceni/', activity: 5 });
  assert.equal(result.parsed.episodes[0].href, '/film/9-show/11-one/prehled/');
  assert.equal(app.request.url, 'https://www.csfd.sk/uzivatel/7-me/hodnoceni/');
  assert.equal(app.request.options.credentials, 'include');
});

test('real offscreen parser detects the authenticated header profile', async () => {
  const app = parserHarness('<header class="page-header user-logged"><ul class="header-bar"><li><a class="profile" href="/uzivatel/7-me/">Me</a></li></ul></header>');
  const result = await app.send({ target: 'offscreen', kind: 'profile', url: 'https://www.csfd.cz/' });
  assert.equal(result.parsed.state, 'in');
  assert.equal(result.parsed.profile.id, 7);
});
