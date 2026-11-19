import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sources = await Promise.all(['settings-page.js', 'viewer.js'].map(name => readFile(new URL(`../extension/${name}`, import.meta.url), 'utf8')));
const flag = 'explore_relaunch_enable_auto_play';
function fixture(t) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const values = { [flag]: Object.freeze({ value: true, bucket: 'native' }), other: { value: true } };
  const switches = {
    getFeatureSwitch(options) { assert.equal(this, switches); return values[options?.name]; },
    isTrue: name => switches.getFeatureSwitch({ name })?.value === true,
    getValue: name => switches.getFeatureSwitch({ name })?.value,
  };
  const main = window.document.querySelector('main');
  main.__reactFiber$fixture = { return: { memoizedProps: { value: { featureSwitches: switches } } } };
  sources.forEach(source => window.eval(source));
  return { window, switches, values, main,
    settings(value) { window.document.dispatchEvent(new window.CustomEvent('ht-settings', { detail: JSON.stringify(value) })); },
    settle: () => new Promise(resolve => setTimeout(resolve, 0)),
  };
}

test('only automatic viewer advancement is disabled, without mutating native flag records', t => {
  const f = fixture(t);
  assert.equal(f.switches.isTrue(flag), false);
  assert.equal(f.switches.getValue(flag), false);
  assert.equal(f.switches.getFeatureSwitch({ name: flag }).bucket, 'native');
  assert.equal(f.values[flag].value, true);
  assert.equal(f.switches.getFeatureSwitch({ name: 'other' }), f.values.other);
  assert.equal(f.switches.getFeatureSwitch({ name: 'missing' }), undefined);
  f.settings({ preventAutoAdvance: false });
  assert.equal(f.switches.getFeatureSwitch({ name: flag }), f.values[flag]);
  f.values[flag] = { value: false };
  assert.equal(f.switches.isTrue(flag), false, 'off restores X’s policy; it never forces advancement on');
  f.settings({});
  assert.equal(f.switches.isTrue(flag), false);
});

test('handles lazy providers and remounts without wrapping a provider twice', async t => {
  const f = fixture(t), original = f.switches.getFeatureSwitch;
  f.main.append(f.window.document.createElement('div')); await f.settle();
  assert.equal(f.switches.getFeatureSwitch, original);
  const replacement = { getFeatureSwitch: () => ({ value: true }) };
  f.main.__reactFiber$fixture.return.memoizedProps.value.featureSwitches = replacement;
  f.main.append(f.window.document.createElement('div')); await f.settle();
  assert.equal(replacement.getFeatureSwitch({ name: flag }).value, false);
  assert.equal(replacement.getFeatureSwitch({ name: 'unrelated' }).value, true);
});
