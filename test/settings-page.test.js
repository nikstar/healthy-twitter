import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../extension/settings-page.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');

test('the standalone page bridge initializes before consumers and accepts only boolean settings', t => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  let ready = 0;
  window.document.addEventListener('ht-settings-ready', () => ready++);
  window.eval(source);
  const config = window[Symbol.for('healthy-twitter.settings')];
  assert.equal(ready, 1);
  let updates = 0; config.subscribe(() => updates++);
  const send = value => window.document.dispatchEvent(new window.CustomEvent('ht-settings', { detail: value }));
  send('{broken'); send('null'); send('[]');
  assert.equal(updates, 0);
  send(JSON.stringify({ preventAutoplay: false, preventLoop: 'false', startMuted: true }));
  assert.equal(config.value.preventAutoplay, false);
  assert.equal(config.value.preventLoop, undefined);
  assert.equal(config.value.startMuted, true);
  assert.equal(updates, 1);
  window.eval(source);
  assert.equal(ready, 1, 'install is idempotent');
  // MAIN consumers use missing !== false before the isolated world's schema arrives.
  window.eval(schema);
  assert.ok(Object.values(window.HealthyTwitterSettings.defaults).every(value => value === true),
    'if a future feature defaults off, add its safe default to the page bridge');
});
