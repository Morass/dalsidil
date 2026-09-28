const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseProfile, detectProfile } = require('../src/profile.js');

function documentFor(html, url = 'https://www.csfd.cz/') {
  return new JSDOM(html, { url }).window.document;
}

test('detects only the signed-in profile link in the account header', () => {
  const doc = documentFor('<header class="page-header user-logged"><a href="/uzivatel/99-someone/">Reviewer</a><ul class="header-bar"><li><a class="profile" href="/uzivatel/7-me/">Me</a></li></ul></header>');
  assert.deepEqual(detectProfile(doc), { state: 'in', profile: { id: 7, href: 'https://www.csfd.cz/uzivatel/7-me/' } });
});

test('a signed-out header is a definite signed-out result', () => {
  const doc = documentFor('<header class="page-header user-not-logged"><a class="profile" href="/uzivatel/7-me/">stale</a></header>');
  assert.deepEqual(detectProfile(doc), { state: 'out', profile: null });
});

test('a logged-in header without its own profile link is unknown', () => {
  const doc = documentFor('<header class="page-header user-logged"><a href="/uzivatel/99-someone/">Comment author</a></header>');
  assert.deepEqual(detectProfile(doc), { state: 'unknown', profile: null });
});

test('a bot challenge is unknown rather than a definite logout', () => {
  const doc = documentFor('<main id="anubis_challenge">Making sure you are not a bot</main>');
  assert.deepEqual(detectProfile(doc), { state: 'unknown', profile: null });
});

test('profile addresses are normalized and foreign hosts are rejected', () => {
  assert.deepEqual(parseProfile('https://www.csfd.sk/en/user/8-reader'), { id: 8, href: 'https://www.csfd.sk/en/user/8-reader/' });
  assert.equal(parseProfile('https://example.com/uzivatel/8-reader/'), null);
});

test('profile addresses accept the Czech sk locale but reject nondefault ports', () => {
  assert.equal(parseProfile('https://www.csfd.sk/cs/uzivatel/123-name/').href, 'https://www.csfd.sk/cs/uzivatel/123-name/');
  assert.equal(parseProfile('https://www.csfd.cz:8443/uzivatel/123-name/'), null);
});
