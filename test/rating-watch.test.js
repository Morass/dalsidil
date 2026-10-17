const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

// Cases: a vote must request refresh; hover/login/unrelated clicks must not;
// rapid votes coalesce; a late server-rendered rating must trigger another read.
function setup() {
  const dom = new JSDOM('<div class="my-rating"><span class="stars-rating"><a class="star" data-rating="80" href="#secureHandle-rating=80"><i>vote</i></a></span></div>', { url: 'https://www.csfd.cz/film/9-show/12-two/prehled/', runScripts: 'outside-only' });
  const messages = [];
  const timers = new Map();
  let serial = 0;
  dom.window.chrome = { runtime: { async sendMessage(m) { messages.push(m); } } };
  dom.window.setTimeout = (fn) => { timers.set(++serial, fn); return serial; };
  dom.window.clearTimeout = (id) => timers.delete(id);
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../content/rating-watch.js'), 'utf8'));
  const flush = async () => { await Promise.resolve(); const work = [...timers.values()]; timers.clear(); for (const fn of work) fn(); await Promise.resolve(); };
  return { dom, messages, flush, star: dom.window.document.querySelector('.star') };
}

test('rating clicks refresh the voted episode once after rapid clicks', async () => {
  const app = setup();
  app.star.querySelector('i').click();
  app.star.click();
  assert.equal(app.messages.length, 0);
  await app.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.messages)), [{ type: 'rating-changed', href: 'https://www.csfd.cz/film/9-show/12-two/prehled/' }]);
  app.dom.window.close();
});

test('hover, unrelated clicks and signed-out registration links do not refresh', async () => {
  const app = setup();
  app.star.dispatchEvent(new app.dom.window.MouseEvent('mouseenter', { bubbles: true }));
  app.dom.window.document.body.click();
  app.star.href = '/registration-motivation/';
  app.star.click();
  await app.flush();
  assert.equal(app.messages.length, 0);
  app.dom.window.close();
});

test('a late saved-rating replacement requests fresh authoritative data again', async () => {
  const app = setup();
  app.star.click();
  await app.flush();
  app.dom.window.document.querySelector('.my-rating').innerHTML = '<span class="stars-rating">saved</span>';
  await app.flush();
  assert.equal(app.messages.length, 2);
  app.dom.window.close();
});
