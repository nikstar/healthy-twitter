import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const playerHTML = (id, cc = true) => `<div data-testid="videoComponent" id="${id}">
  <video></video><div class="controls"><div role="slider" aria-label="Progress"></div>
  <div style="display:flex;flex-direction:row" class="bottom">
    <div><button>Play</button></div><div style="display:flex;flex-direction:row" class="right">
      <span>0:10 / 1:07</span>${cc ? '<div class="cc"><button>CC</button></div>' : ''}
      <div class="volume"><button>Volume</button><div role="slider" aria-label="Volume"></div></div>
      <div><div><button>Settings</button></div></div><div><button>PiP</button></div><div><button>Fullscreen</button></div>
    </div>
  </div></div></div>`;
const menuHTML = `<div role="menu"><div data-testid="Dropdown">
  <div role="menuitem" tabindex="0"><div><span>Copy video address</span></div></div>
  <div role="menuitem" tabindex="0" data-testid="copyVideoLinkAtCurrentTimeContextMenuItem"><div><span>Copy link at current time</span></div></div>
  <div role="menuitem" tabindex="0" data-testid="postVideoContextMenuItem"><div><span>Post Video</span></div></div>
</div></div>`;
const gifHTML = (id, badge = true) => `<div data-testid="videoComponent" id="${id}">
  <video src="https://video.twimg.com/tweet_video/HWc2YIWWUAAADXE.mp4" poster="https://pbs.twimg.com/tweet_video_thumb/HWc2YIWWUAAADXE.jpg"></video>
  ${badge ? '<div class="gif-row" style="display:flex;flex-direction:row"><div><button>Pause</button></div><div class="gif-badge"><div><span>GIF</span></div></div></div>' : ''}
</div>`;
const gifMenuHTML = `<div role="menu"><div data-testid="Dropdown"><div role="menuitem" tabindex="0"><div><span>Copiar dirección del GIF</span></div></div></div></div>`;

function fixture(t, markup = playerHTML('a')) {
  const dom = new JSDOM(`<body>${markup}</body>`, { url: 'https://x.com/test/status/123', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const messages = [];
  const handlers = new WeakMap();
  const add = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, listener, options) {
    let map = handlers.get(this);
    if (!map) { map = new Map(); handlers.set(this, map); }
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(listener);
    return add.call(this, type, listener, options);
  };
  window.chrome = { runtime: { sendMessage: async message => { messages.push(message); return { id: 7, width: 720, height: 1280 }; } } };
  window.eval(source);
  const trusted = (target, type, extras = {}) => {
    const event = { target, isTrusted: true, preventDefault() {}, stopPropagation() {}, ...extras };
    for (const handler of handlers.get(target)?.get(type) || []) handler(event);
  };
  return { window, document: window.document, messages, trusted,
    settle: () => new Promise(resolve => setTimeout(resolve, 50)) };
}

test('places one button beside captions, survives remounts, and never toggles playback', async t => {
  const f = fixture(t);
  const button = f.document.querySelector('.xvs-download-button');
  assert.ok(button);
  assert.equal(button.parentElement.previousElementSibling.className, 'cc');
  assert.equal(button.parentElement.nextElementSibling.className, 'volume');
  let playerClicks = 0;
  f.document.querySelector('#a').addEventListener('click', () => playerClicks++);
  button.click();
  assert.equal(playerClicks, 0);
  assert.equal(f.messages.length, 0, 'page-created synthetic clicks cannot initiate downloads');
  f.trusted(button, 'click');
  await f.settle();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].type, 'download-player');
  assert.equal(f.messages[0].playerToken, f.document.querySelector('#a').dataset.xvsPlayer);
  assert.match(f.document.querySelector('.xvs-toast').textContent, /Download started \(720 × 1280\)/);
  button.parentElement.remove();
  await f.settle();
  assert.equal(f.document.querySelectorAll('.xvs-download-button').length, 1);
  f.document.querySelector('#a .controls').outerHTML = playerHTML('b', false);
  await f.settle();
  assert.equal(f.document.querySelectorAll('.xvs-download-button').length, 1);
});

test('extends only a video context menu and downloads the right-clicked player', async t => {
  const f = fixture(t, playerHTML('a') + playerHTML('b'));
  const playerB = f.document.querySelector('#b');
  f.trusted(f.document, 'contextmenu', { target: playerB.querySelector('video') });
  f.document.body.insertAdjacentHTML('beforeend', menuHTML);
  await f.settle();
  const menu = f.document.querySelector('[role="menu"]');
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent),
    ['Copy video address', 'Copy link at current time', 'Post Video', 'Download video']);
  const item = menu.querySelector('[data-xvs-action]');
  assert.equal(item.hasAttribute('data-testid'), false);
  f.trusted(item, 'click');
  await f.settle();
  assert.equal(f.messages[0].playerToken, playerB.dataset.xvsPlayer);
  assert.equal(f.document.querySelector('#a').hasAttribute('data-xvs-player'), false);
  assert.equal(menu.querySelectorAll('[data-xvs-action]').length, 1);
  menu.remove();
  f.trusted(f.document, 'contextmenu', { target: f.document.body });
  f.document.body.insertAdjacentHTML('beforeend', '<div role="menu"><div role="menuitem">Copy link</div></div>');
  await f.settle();
  assert.equal(f.document.querySelector('[role="menu"] [data-xvs-action]'), null);
});

test('includes the added menu item in keyboard navigation', async t => {
  const f = fixture(t);
  f.trusted(f.document, 'contextmenu', { target: f.document.querySelector('video') });
  f.document.body.insertAdjacentHTML('beforeend', menuHTML);
  await f.settle();
  const items = [...f.document.querySelectorAll('[role="menuitem"]')];
  items[2].focus();
  items[2].dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(f.document.activeElement, items[3]);
  items[3].dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(f.document.activeElement, items[0]);
});

test('dismisses with X’s keyup handler and retargets a reused menu to the latest player', async t => {
  const f = fixture(t, playerHTML('a') + playerHTML('b'));
  f.trusted(f.document, 'contextmenu', { target: f.document.querySelector('#a video') });
  f.document.body.insertAdjacentHTML('beforeend', menuHTML);
  await f.settle();
  const menu = f.document.querySelector('[role="menu"]');
  const item = menu.querySelector('[data-xvs-action]');
  let dismissed = false;
  menu.addEventListener('keyup', event => { if (event.key === 'Escape') dismissed = true; });
  f.trusted(f.document, 'contextmenu', { target: f.document.querySelector('#b video') });
  await f.settle();
  f.trusted(item, 'click');
  await f.settle();
  assert.equal(dismissed, true);
  assert.equal(f.messages[0].playerToken, f.document.querySelector('#b').dataset.xvsPlayer);
  assert.equal(f.document.querySelector('#a').hasAttribute('data-xvs-player'), false);
  assert.equal(menu.querySelectorAll('[data-xvs-action]').length, 1);
});

test('does not download after the clicked player disappears, and reports worker errors', async t => {
  const f = fixture(t);
  const player = f.document.querySelector('#a');
  const button = player.querySelector('.xvs-download-button');
  player.remove();
  f.trusted(button, 'click');
  assert.equal(f.messages.length, 0);
  assert.match(f.document.querySelector('.xvs-toast').textContent, /no longer on the page/);
  f.document.body.append(player);
  f.window.chrome.runtime.sendMessage = async () => ({ error: 'No MP4 found.' });
  f.trusted(button, 'click');
  await f.settle();
  assert.match(f.document.querySelector('.xvs-error').textContent, /No MP4 found/);
  assert.equal(button.hasAttribute('aria-busy'), false);
});

test('adds a compact GIF button beside the GIF badge and keeps the original download flow', async t => {
  const f = fixture(t, gifHTML('gif'));
  const button = f.document.querySelector('.xvs-download-button');
  assert.equal(button.getAttribute('aria-label'), 'Download GIF');
  assert.equal(button.title, 'Download GIF as original MP4');
  assert.ok(button.parentElement.classList.contains('xvs-gif-control'));
  assert.equal(button.parentElement.nextElementSibling.className, 'gif-badge');
  assert.equal(button.parentElement.parentElement.className, 'gif-row');
  f.trusted(button, 'click');
  await f.settle();
  assert.equal(f.messages[0].type, 'download-player');
  assert.equal(f.messages[0].playerToken, f.document.querySelector('#gif').dataset.xvsPlayer);
});

test('moves a GIF fallback button into the native controls when they mount', async t => {
  const f = fixture(t, gifHTML('gif', false));
  assert.equal(f.document.querySelectorAll('.xvs-gif-fallback').length, 1);
  f.document.querySelector('#gif').insertAdjacentHTML('beforeend', '<div class="gif-row" style="display:flex;flex-direction:row"><button>Play</button><div><span>GIF</span></div></div>');
  await f.settle();
  assert.equal(f.document.querySelectorAll('.xvs-gif-fallback').length, 0);
  assert.equal(f.document.querySelectorAll('.xvs-download-button').length, 1);
  assert.equal(f.document.querySelector('.xvs-control-slot').parentElement.className, 'gif-row');
});

test('extends a localized GIF menu without video-only markers, preserving its copy action', async t => {
  const f = fixture(t, gifHTML('a') + gifHTML('b'));
  const playerB = f.document.querySelector('#b');
  f.trusted(f.document, 'contextmenu', { target: playerB.querySelector('video') });
  f.document.body.insertAdjacentHTML('beforeend', gifMenuHTML);
  await f.settle();
  const menu = f.document.querySelector('[role="menu"]');
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map(e => e.textContent), ['Copiar dirección del GIF', 'Download GIF']);
  f.trusted(menu.querySelector('.xvs-menu-item'), 'click');
  await f.settle();
  assert.equal(f.messages[0].playerToken, playerB.dataset.xvsPlayer);
  assert.equal(f.document.querySelector('#a').hasAttribute('data-xvs-player'), false);
});

test('does not mistake a pre-existing unrelated menu for the GIF menu', async t => {
  const f = fixture(t, gifHTML('a') + '<div role="menu"><div data-testid="Dropdown"><div role="menuitem">Unrelated action</div></div></div>');
  f.trusted(f.document, 'contextmenu', { target: f.document.querySelector('video') });
  await f.settle();
  assert.equal(f.document.querySelector('.xvs-menu-item'), null);
});

test('detects a GIF when metadata arrives after its player shell', async t => {
  const f = fixture(t, '<div data-testid="videoComponent"><video></video></div>');
  assert.equal(f.document.querySelector('.xvs-download-button'), null);
  const video = f.document.querySelector('video');
  video.src = 'https://video.twimg.com/tweet_video/HWc2YIWWUAAADXE.mp4';
  video.dispatchEvent(new f.window.Event('loadedmetadata'));
  await f.settle();
  assert.equal(f.document.querySelector('.xvs-download-button').getAttribute('aria-label'), 'Download GIF');
});
