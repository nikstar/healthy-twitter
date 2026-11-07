import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyLedger, installActivity } from '../extension/activity.js';
const { dayKey } = globalThis.HealthyTwitterSettings;

test('daily timer counts one owner, pauses, survives reloads, and excludes suspended time', () => {
  const now = new Date(2026, 10, 7, 12).getTime();
  const ledger = new DailyLedger(null, now);
  ledger.active = true;
  assert.equal(ledger.settle(now + 5000).milliseconds, 5000);
  assert.equal(ledger.settle(now + 5000).milliseconds, 5000, 'another tab heartbeat cannot double count');
  ledger.active = false;
  assert.equal(ledger.settle(now + 10000).milliseconds, 5000);
  ledger.active = true;
  assert.equal(ledger.settle(now + 15000).milliseconds, 10000);
  assert.equal(ledger.settle(now + 120000).milliseconds, 10000, 'sleep is not browsing time');
  const resumed = new DailyLedger(ledger.snapshot(), now + 120000);
  assert.equal(resumed.settle(now + 125000).milliseconds, 10000, 'a new worker starts inactive');
  assert.equal(ledger.settle(now + 119000).milliseconds, 10000, 'backwards clock never subtracts time');
});

test('day changes split an active interval at local midnight and reset stale stored totals', () => {
  const now = new Date(2026, 10, 7, 23, 59, 58).getTime();
  const ledger = new DailyLedger({ day: dayKey(now), milliseconds: 20000 }, now);
  ledger.active = true;
  const next = ledger.settle(now + 5000);
  assert.equal(next.day, dayKey(now + 5000));
  assert.equal(next.milliseconds, 3000);
  assert.equal(new DailyLedger({ day: '2020-01-01', milliseconds: 9999 }, now).milliseconds, 0);
});

function harness(t) {
  let now = new Date(2026, 10, 7, 12).getTime();
  t.mock.method(Date, 'now', () => now);
  const listeners = {};
  const event = name => ({ addListener: fn => { listeners[name] = fn; } });
  const saved = {};
  const state = { focused: true, active: 1, url: 'https://x.com/home' };
  const chrome = {
    storage: { local: { get: async () => ({ ...saved }), set: async value => Object.assign(saved, value) }, onChanged: event('settings') },
    tabs: { query: async () => [{ id: state.active, url: state.url }], onActivated: event('tab'), onRemoved: event('removed'), onUpdated: event('updated') },
    windows: { getLastFocused: async () => ({ id: 1, focused: state.focused }), onFocusChanged: event('focus') },
  };
  const activity = installActivity(chrome);
  return { activity, state, saved, listeners, advance: ms => { now += ms; }, pulse: id => activity.pulse({ tab: { id } }) };
}

test('worker verifies focus, active X tab, tab switches, and a shared persisted total', async t => {
  const f = harness(t);
  assert.equal((await f.pulse(1)).active, true);
  f.advance(5000);
  assert.equal((await f.pulse(2)).active, false, 'background sender cannot claim foreground ownership');
  assert.equal(f.saved.dailyUsage.milliseconds, 5000);
  f.advance(1000); f.state.focused = false; f.listeners.focus();
  await f.activity.getUsage();
  assert.equal(f.saved.dailyUsage.milliseconds, 6000);
  f.advance(5000); await f.pulse(1);
  assert.equal(f.saved.dailyUsage.milliseconds, 6000);
  f.state.focused = true; f.state.active = 2; f.listeners.tab(); await f.pulse(2);
  f.advance(2000); assert.equal((await f.pulse(2)).milliseconds, 8000);
  f.state.url = 'https://example.com'; f.listeners.updated(2, { url: f.state.url }); await f.activity.getUsage();
  f.advance(2000); await f.activity.getUsage();
  assert.equal(f.saved.dailyUsage.milliseconds, 8000);
});

test('turning off the timer stops collection and preserves today’s accumulated time', async t => {
  const f = harness(t); await f.pulse(1); f.advance(3000);
  f.listeners.settings({ settings: { newValue: { showTimer: false } } }, 'local');
  await f.activity.getUsage();
  f.advance(5000); const result = await f.pulse(1);
  assert.equal(result.active, false); assert.equal(result.milliseconds, 3000);
});
