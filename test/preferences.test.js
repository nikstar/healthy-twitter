import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../extension/preferences.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../extension/settings-bridge.js', import.meta.url), 'utf8');
const tabs = '<main><div role="tablist"><button role="tab" aria-selected="true">Para ti</button><button role="tab" aria-selected="false">Siguiendo</button></div></main>';
async function fixture(t, { settings = {}, path = '/home', markup = tabs } = {}) {
  const dom = new JSDOM(markup, { url: `https://x.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom, { document } = window;
  const changed = [];
  let selections = 0;
  window.chrome = { storage: { local: { get: async () => ({ settings }) }, onChanged: { addListener: fn => changed.push(fn) } },
    runtime: { sendMessage: async () => ({ day: window.HealthyTwitterSettings.dayKey(), milliseconds: 65000, active: true }) } };
  const wire = () => document.querySelectorAll('[role=tab]').forEach(tab => tab.addEventListener('click', () => {
    selections++; document.querySelectorAll('[role=tab]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
  }));
  wire();
  window.eval(schema); window.eval(bridge); window.eval(source);
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  await settle();
  return { window, document, settle, wire, selections: () => selections,
    update(value) { changed.forEach(fn => fn({ settings: { newValue: value } }, 'local')); },
    navigate(path) { window.history.pushState({}, '', path); window.dispatchEvent(new window.PopStateEvent('popstate')); },
  };
}

test('defaults to Following once on entering Home and permits a manual For You choice', async t => {
  const f = await fixture(t);
  assert.equal(f.selections(), 1);
  const [forYou, following] = f.document.querySelectorAll('[role=tab]');
  assert.equal(following.getAttribute('aria-selected'), 'true');
  forYou.click(); await f.settle();
  assert.equal(forYou.getAttribute('aria-selected'), 'true');
  f.navigate('/alice/status/1'); await f.settle();
  f.navigate('/home'); await f.settle();
  assert.equal(following.getAttribute('aria-selected'), 'true');
});

test('waits for lazy home tabs and leaves other routes and disabled defaults alone', async t => {
  const f = await fixture(t, { markup: '<main></main>' });
  f.document.querySelector('main').outerHTML = tabs; f.wire(); await f.settle();
  assert.equal(f.selections(), 1);
  const other = await fixture(t, { path: '/search' }); assert.equal(other.selections(), 0);
  const disabled = await fixture(t, { settings: { defaultFollowing: false } }); assert.equal(disabled.selections(), 0);
  disabled.update({ defaultFollowing: true }); await disabled.settle(); assert.equal(disabled.selections(), 1);
});

test('timer moves into the sidebar, remounts, and can be switched off and on live', async t => {
  const f = await fixture(t);
  let card = f.document.querySelector('.ht-time-card'); assert.ok(card.classList.contains('ht-time-floating'));
  assert.equal(card.querySelector('strong').textContent, '0:01:05');
  f.document.body.insertAdjacentHTML('beforeend', '<div data-testid="sidebarColumn"></div>'); await f.settle();
  assert.equal(card.parentElement.dataset.testid, 'sidebarColumn');
  assert.equal(card.classList.contains('ht-time-floating'), false);
  card.remove(); await f.settle(); assert.ok(card.isConnected);
  f.update({ showTimer: false }); await f.settle(); assert.equal(f.document.querySelector('.ht-time-card'), null);
  f.update({ showTimer: true, greyPaused: false }); await f.settle();
  assert.equal(f.document.querySelectorAll('.ht-time-card').length, 1);
  assert.equal(f.window[Symbol.for('healthy-twitter.settings')].value.greyPaused, false);
});

test('settings normalize only boolean known keys and ignore malformed bridge events', async t => {
  const f = await fixture(t);
  f.document.dispatchEvent(new f.window.CustomEvent('ht-settings', { detail: '{bad json' }));
  f.document.dispatchEvent(new f.window.CustomEvent('ht-settings', { detail: JSON.stringify({ startMuted: false, greyPaused: 'false', random: false }) }));
  const value = f.window[Symbol.for('healthy-twitter.settings')].value;
  assert.equal(value.startMuted, false); assert.equal(value.greyPaused, true); assert.equal(value.random, undefined);
});


test('timer clears X’s fixed search header and falls back when the sidebar is hidden', async t => {
  const f = await fixture(t, { markup: tabs + '<div data-testid="sidebarColumn"><div class="fixed-search" style="position:fixed;top:0"><form role="search"><input></form></div></div>' });
  f.document.querySelector('.fixed-search').getBoundingClientRect = () => ({ bottom: 53 });
  f.update({}); await f.settle();
  const card = f.document.querySelector('.ht-time-card');
  assert.equal(card.style.getPropertyValue('--ht-time-top'), '65px');
  assert.equal(card.querySelector('.ht-time-note'), null, 'no redundant subtitle');
  f.document.querySelector('[data-testid="sidebarColumn"]').style.display = 'none';
  f.window.dispatchEvent(new f.window.Event('resize')); await f.settle();
  assert.equal(card.parentElement, f.document.body);
});
