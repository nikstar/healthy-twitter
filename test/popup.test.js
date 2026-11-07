import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');
async function fixture(t) {
  const dom = new JSDOM(html, { url: 'https://fixture.test/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const { window } = dom;
  const listeners = [], stored = { settings: { startMuted: false } }; let fail = false;
  window.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async value => { if (fail) throw new Error('storage failed'); Object.assign(stored, value); listeners.forEach(fn => fn({ settings: { newValue: value.settings } }, 'local')); },
  }, onChanged: { addListener: fn => listeners.push(fn) } }, runtime: { sendMessage: async () => ({ milliseconds: 62000, day: window.HealthyTwitterSettings.dayKey() }) } };
  window.eval(schema); await window.eval(`(async () => {${source}\n})()`);
  return { window, stored, fail: () => { fail = true; }, input: name => window.document.querySelector(`[name="${name}"]`),
    toggle(name) { const input = this.input(name); input.checked = !input.checked; input.dispatchEvent(new window.Event('change', { bubbles: true })); },
    settle: () => new Promise(resolve => setTimeout(resolve, 0)) };
}
test('settings popup loads all preferences and persists rapid independent changes', async t => {
  const f = await fixture(t);
  assert.equal(f.input('startMuted').checked, false);
  assert.equal(f.input('preventLoop').checked, true);
  assert.equal(f.window.document.querySelector('#today-time').textContent, '0:01:02');
  f.toggle('preventLoop'); f.toggle('playerDownload'); await f.settle();
  assert.equal(f.stored.settings.preventLoop, false); assert.equal(f.stored.settings.playerDownload, false);
  assert.equal(f.stored.settings.startMuted, false);
  assert.match(f.window.document.querySelector('#status').textContent, /Saved/);
});
test('a failed preference save is visible and restores the previous switch value', async t => {
  const f = await fixture(t); f.fail(); f.toggle('preventLoop'); await f.settle();
  assert.equal(f.input('preventLoop').checked, true);
  assert.match(f.window.document.querySelector('#status').textContent, /Couldn’t save/);
});
