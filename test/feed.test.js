import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const settingsSource = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../extension/settings-bridge.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../extension/feed.js', import.meta.url), 'utf8');
const postHTML = (id, handle) => `<div data-testid="cellInnerDiv"><article data-testid="tweet" id="post-${id}">
  <div class="author-row"><div data-testid="User-Name"><a href="/${handle}">@${handle}</a><a href="/${handle}/status/${id}"><time>1h</time></a></div>
  <div class="native-actions"><button data-testid="caret" aria-label="More">…</button></div></div><p>Post ${id}</p>
</article></div>`;

function fixture(t, { path = '/home', selected = 0, posts = [['11', 'alice', '101'], ['12', 'alice', '101'], ['21', 'bob', '202'], ['99', 'me', '99']] } = {}) {
  const dom = new JSDOM(`<main><div role="tablist"><div role="tab" aria-selected="${selected === 0}">Para ti</div><div role="tab" aria-selected="${selected === 1}">Siguiendo</div></div>${posts.map(([id, handle]) => postHTML(id, handle)).join('')}</main>`, {
    url: `https://x.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom, { document } = window;
  t.after(() => window.close());
  const handlers = new WeakMap(), records = [], contexts = new Map();
  const add = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, callback, options) {
    let map = handlers.get(this);
    if (!map) { map = new Map(); handlers.set(this, map); }
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(callback);
    return add.call(this, type, callback, options);
  };
  const effects = { block: async () => {}, unblock: async () => {}, apply: async () => {}, undo: async () => {} };
  const feedbackRecords = {};
  const store = { getState: () => ({ urt: { home: { responseObjects: { feedbackActions: feedbackRecords } } } }) };
  for (const [id, handle, userId] of posts) {
    const post = document.querySelector(`#post-${id}`);
    const rootKey = `root-${id}`, childKey = `account-${id}`;
    const root = { feedbackKey: rootKey, feedbackType: 'DontLike', hasUndoAction: true, childKeys: [childKey, `irrelevant-${id}`] };
    feedbackRecords[rootKey] = root;
    feedbackRecords[childKey] = { feedbackType: 'SeeFewer', hasUndoAction: true, prompt: `Show fewer posts from ${handle}` };
    feedbackRecords[`irrelevant-${id}`] = { feedbackType: 'NotRelevant', hasUndoAction: true };
    const account = {
      tweet: { id_str: id, user: { screen_name: handle, id_str: userId, blocking: false } },
      block: async (...args) => { records.push({ type: 'block', args }); await effects.block(...args); account.tweet.user.blocking = true; },
      unblock: async (...args) => { records.push({ type: 'unblock', args }); await effects.unblock(...args); account.tweet.user.blocking = false; },
    };
    const feedback = {
      entry: { type: 'tweet', entryId: `tweet-${id}`, content: { id }, itemMetadata: { feedbackInfo: { feedbackKeys: [rootKey] } } },
      feedbackActions: [root],
      applyFeedbackAction: async payload => { records.push({ type: 'apply', payload }); return effects.apply(payload); },
      undoFeedbackAction: async payload => { records.push({ type: 'undo', payload }); return effects.undo(payload); },
    };
    post.querySelector('[data-testid="caret"]').__reactFiber$fixture = { stateNode: { props: account, context: { viewerUserId: '99' } } };
    post.__reactFiber$fixture = { memoizedProps: feedback, dependencies: { firstContext: { memoizedValue: { store } } } };
    contexts.set(id, { account, feedback, post });
  }
  window.eval(settingsSource); window.eval(bridgeSource);
  window.eval(source);
  const trusted = (target, extra = {}) => {
    assert.ok(target, 'action exists');
    for (const callback of handlers.get(target)?.get('click') || []) callback({ target, isTrusted: true, detail: 1, preventDefault() {}, stopPropagation() {}, ...extra });
  };
  return { window, document, contexts, records, effects, feedbackRecords, trusted,
    button: (id, kind) => document.querySelector(`#post-${id} [data-ht-feed-action="${kind}"]`),
    undo: () => document.querySelector('.ht-feed-toast button'),
    settle: () => new Promise(resolve => setTimeout(resolve, 40)),
  };
}

test('places all three controls in For You author rows, skips self, and survives remounts', async t => {
  const f = fixture(t);
  const group = f.document.querySelector('#post-11 .ht-feed-actions');
  assert.ok(group.parentElement.classList.contains('native-actions'));
  assert.equal(group.nextElementSibling.getAttribute('data-testid'), 'caret');
  assert.equal(group.querySelectorAll('button').length, 3);
  assert.equal(f.document.querySelector('#post-99 .ht-feed-actions'), null);
  group.remove();
  await f.settle();
  assert.equal(f.document.querySelectorAll('#post-11 .ht-feed-actions').length, 1);
});

test('shows only Block in Following and replies, and updates when tabs change', async t => {
  const f = fixture(t, { selected: 1 });
  assert.equal(f.document.querySelectorAll('#post-11 .ht-feed-actions button').length, 1);
  assert.ok(f.button('11', 'block'));
  const tabs = f.document.querySelectorAll('[role="tab"]');
  tabs[0].setAttribute('aria-selected', 'true'); tabs[1].setAttribute('aria-selected', 'false');
  await f.settle();
  assert.equal(f.document.querySelectorAll('#post-11 .ht-feed-actions button').length, 3);
  f.window.history.pushState({}, '', '/alice/status/11');
  f.window.dispatchEvent(new f.window.PopStateEvent('popstate'));
  await f.settle();
  assert.equal(f.document.querySelectorAll('#post-11 .ht-feed-actions button').length, 1);
});

test('sends exact native Not interested feedback and undoes it after the post is replaced', async t => {
  const f = fixture(t);
  const post = f.contexts.get('11').post, cell = post.parentElement;
  f.effects.apply = async () => { cell.replaceChildren(f.document.createTextNode('Thanks for the feedback.')); };
  f.trusted(f.button('11', 'not-interested'));
  await f.settle();
  assert.equal(f.records[0].type, 'apply');
  assert.deepEqual([...f.records[0].payload.feedbackKeys], ['root-11']);
  assert.equal(f.records[0].payload.entry.content.id, '11');
  assert.equal(cell.hasAttribute('data-ht-feed-hidden'), true);
  f.trusted(f.undo());
  await f.settle();
  assert.equal(f.records[1].type, 'undo');
  assert.equal(f.records[1].payload, f.records[0].payload);
  assert.equal(cell.hasAttribute('data-ht-feed-hidden'), false);
});

test('Show less applies two native steps and Undo reverses each in order', async t => {
  const f = fixture(t);
  f.trusted(f.button('11', 'less-account'));
  await f.settle();
  assert.deepEqual([...f.records[0].payload.feedbackKeys], ['root-11']);
  assert.deepEqual([...f.records[1].payload.feedbackKeys], ['account-11', 'root-11']);
  assert.match(f.document.querySelector('.ht-feed-toast').textContent, /Showing less from @alice/);
  f.trusted(f.undo());
  await f.settle();
  assert.deepEqual(f.records.map(r => r.type), ['apply', 'apply', 'undo', 'undo']);
  assert.deepEqual([...f.records[2].payload.feedbackKeys], ['account-11', 'root-11']);
  assert.deepEqual([...f.records[3].payload.feedbackKeys], ['root-11']);
});

test('rolls back both feedback steps if the account-specific step fails', async t => {
  const f = fixture(t);
  f.effects.apply = async payload => { if (payload.feedbackKeys[0] === 'account-11') throw new Error('offline'); };
  f.trusted(f.button('11', 'less-account'));
  await f.settle();
  assert.deepEqual(f.records.map(r => [r.type, r.payload.feedbackKeys[0]]), [
    ['apply', 'root-11'], ['apply', 'account-11'], ['undo', 'account-11'], ['undo', 'root-11'],
  ]);
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
  assert.match(f.document.querySelector('.ht-feed-error').textContent, /Couldn’t update/);
});

test('keeps an incomplete rollback retryable without repeating successful inverses', async t => {
  const f = fixture(t);
  f.effects.apply = async payload => { if (payload.feedbackKeys[0] === 'account-11') throw new Error('offline'); };
  f.effects.undo = async payload => { if (payload.feedbackKeys[0] === 'root-11') throw new Error('offline'); };
  f.trusted(f.button('11', 'less-account'));
  await f.settle();
  assert.match(f.undo().parentElement.textContent, /Undo to restore/);
  f.effects.undo = async () => {};
  f.trusted(f.undo()); await f.settle();
  assert.deepEqual(f.records.filter(r => r.type === 'undo').map(r => r.payload.feedbackKeys[0]), ['account-11', 'root-11', 'root-11']);
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
});

test('blocks the exact author without a dialog and Undo unblocks, restoring their posts', async t => {
  const f = fixture(t);
  const button = f.button('11', 'block');
  f.trusted(button); f.trusted(button);
  await f.settle();
  assert.deepEqual(f.records.map(r => r.type), ['block']);
  assert.equal(f.records[0].args[0], '101');
  for (const id of ['11', '12']) assert.equal(f.contexts.get(id).post.parentElement.hasAttribute('data-ht-feed-hidden'), true);
  assert.equal(f.contexts.get('21').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
  assert.equal(f.document.querySelector('[role="dialog"]'), null);
  f.trusted(f.undo()); await f.settle();
  assert.equal(f.records[1].type, 'unblock');
  assert.equal(f.records[1].args[0], '101');
  for (const id of ['11', '12']) assert.equal(f.contexts.get(id).post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
});

test('Undo requested before a pending block finishes runs after it completes', async t => {
  const f = fixture(t);
  let finish;
  f.effects.block = () => new Promise(resolve => { finish = resolve; });
  f.trusted(f.button('11', 'block'));
  await f.settle();
  f.trusted(f.undo());
  assert.equal(f.undo().disabled, true);
  assert.deepEqual(f.records.map(r => r.type), ['block']);
  finish(); await f.settle();
  assert.deepEqual(f.records.map(r => r.type), ['block', 'unblock']);
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
});

test('failed actions restore the post and failed Undo remains retryable', async t => {
  const f = fixture(t);
  f.effects.block = async () => { throw new Error('offline'); };
  f.trusted(f.button('11', 'block')); await f.settle();
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
  assert.match(f.document.querySelector('.ht-feed-error').textContent, /Couldn’t block/);
  assert.equal(f.undo(), null);
  f.effects.block = async () => {};
  f.trusted(f.button('11', 'block')); await f.settle();
  f.effects.unblock = async () => { throw new Error('offline'); };
  f.trusted(f.undo()); await f.settle();
  assert.equal(f.undo().disabled, false);
  assert.match(f.undo().parentElement.textContent, /Couldn’t undo/);
  f.effects.unblock = async () => {};
  f.trusted(f.undo()); await f.settle();
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
});

test('rejects synthetic clicks, recycled post targets, and unrelated feedback records', async t => {
  const f = fixture(t);
  const button = f.button('11', 'block');
  button.click(); await f.settle();
  assert.equal(f.records.length, 0);
  f.document.querySelector('#post-11 [data-testid="User-Name"] a').href = '/mallory';
  f.trusted(button); await f.settle();
  assert.equal(f.records.length, 0);
  f.feedbackRecords['account-21'].prompt = 'Show fewer posts from mallory';
  f.document.querySelector('#post-21 p').append(f.document.createElement('span'));
  await f.settle();
  assert.equal(f.button('21', 'less-account'), null);
});

test('keyboard activation moves focus to Undo and separate actions retain separate Undo buttons', async t => {
  const f = fixture(t);
  f.trusted(f.button('11', 'not-interested'), { detail: 0 });
  assert.equal(f.document.activeElement, f.undo());
  f.trusted(f.button('21', 'block'));
  await f.settle();
  const buttons = f.document.querySelectorAll('.ht-feed-toast button');
  assert.equal(buttons.length, 2);
  f.trusted(buttons[0]); await f.settle();
  assert.equal(f.contexts.get('11').post.parentElement.hasAttribute('data-ht-feed-hidden'), false);
  assert.equal(f.contexts.get('21').post.parentElement.hasAttribute('data-ht-feed-hidden'), true);
});

test('keyboard activation does not reach X’s post navigation shortcuts', t => {
  const f = fixture(t);
  let navigations = 0;
  const post = f.contexts.get('11').post;
  for (const type of ['keydown', 'keyup']) post.addEventListener(type, () => navigations++);
  for (const type of ['keydown', 'keyup']) for (const key of ['Enter', ' ']) {
    f.button('11', 'block').dispatchEvent(new f.window.KeyboardEvent(type, { key, bubbles: true }));
  }
  assert.equal(navigations, 0);
});

test('settings hide individual shortcuts without removing an outstanding Undo', async t => {
  const f = fixture(t);
  f.trusted(f.button('11', 'block'));
  await f.settle();
  f.document.dispatchEvent(new f.window.CustomEvent('ht-settings', { detail: JSON.stringify({ showBlock: false, showNotInterested: false }) }));
  await f.settle();
  assert.equal(f.button('21', 'block'), null);
  assert.equal(f.button('21', 'not-interested'), null);
  assert.ok(f.button('21', 'less-account'));
  assert.ok(f.undo());
  f.trusted(f.undo()); await f.settle();
  assert.equal(f.records.at(-1).type, 'unblock');
});
