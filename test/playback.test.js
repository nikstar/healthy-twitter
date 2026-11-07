import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const settingsSource = await readFile(new URL('../extension/settings.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../extension/settings-bridge.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../extension/playback.js', import.meta.url), 'utf8');
const markup = id => `<div data-testid="videoComponent" id="${id}"><video src="${id}.mp4" autoplay loop></video>
  <button class="play" aria-label="Reproducir">Play</button>
  <div role="slider" tabindex="0"></div><button class="mute">Mute</button>
  <div data-xvs-owned><button class="download">Download</button></div>
</div>`;

function fixture(t, html = markup('a') + markup('b')) {
  const dom = new JSDOM(html, { url: 'https://x.com/test/status/123', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  let clock = 100;
  Object.defineProperty(window.performance, 'now', { value: () => clock });
  const media = new WeakMap();
  const handlers = new Map();
  const data = element => {
    if (!media.has(element)) media.set(element, { paused: true, ended: false, time: 0, duration: 10, plays: 0, pauses: 0 });
    return media.get(element);
  };
  const prototype = window.HTMLMediaElement.prototype;
  for (const [key, field] of [['paused', 'paused'], ['ended', 'ended'], ['duration', 'duration']]) {
    Object.defineProperty(prototype, key, { configurable: true, get() { return data(this)[field]; } });
  }
  Object.defineProperty(prototype, 'currentTime', { configurable: true,
    get() { return data(this).time; }, set(value) { data(this).time = Number(value); data(this).ended = false; } });
  prototype.play = function() {
    const state = data(this);
    if (state.ended) { state.time = 0; state.ended = false; }
    state.paused = false;
    state.plays++;
    this.dispatchEvent(new window.Event('play'));
    this.dispatchEvent(new window.Event('playing'));
    return Promise.resolve();
  };
  prototype.pause = function() {
    const state = data(this);
    state.pauses++;
    if (!state.paused) { state.paused = true; this.dispatchEvent(new window.Event('pause')); }
  };
  prototype.fastSeek = function(value) { data(this).time = value; };
  const originalAdd = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (type, handler, options) => {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(handler);
    originalAdd(type, handler, options);
  };
  window.eval(settingsSource); window.eval(bridgeSource);
  window.eval(source);
  const trusted = (target, type = 'click', extra = {}) => {
    for (const handler of handlers.get(type) || []) handler({ target, isTrusted: true, button: 0, repeat: false, ...extra });
  };
  return { window, document: window.document, data, trusted,
    video: id => window.document.querySelector(`#${id} video`),
    play: id => window.document.querySelector(`#${id} .play`),
    advance: milliseconds => { clock += milliseconds; },
    settle: () => new Promise(resolve => setTimeout(resolve, 0)),
    end(video) {
      Object.assign(data(video), { time: data(video).duration, paused: true, ended: true });
      video.dispatchEvent(new window.Event('ended'));
    },
  };
}

test('blocks startup, attribute autoplay, and looping without changing audio', async t => {
  const f = fixture(t);
  const video = f.video('a');
  assert.equal(video.autoplay, false);
  assert.equal(video.loop, false);
  video.autoplay = true; video.loop = true;
  assert.equal(video.autoplay, false);
  assert.equal(video.loop, false);
  video.setAttribute('autoplay', ''); video.setAttribute('loop', '');
  await f.settle();
  assert.equal(video.hasAttribute('autoplay'), false);
  assert.equal(video.hasAttribute('loop'), false);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  assert.equal(f.data(video).plays, 0);
  assert.equal(video.dataset.htPlaying, 'false');
  const audio = f.document.createElement('audio');
  audio.loop = true;
  await audio.play();
  assert.equal(audio.loop, true);
  assert.equal(audio.paused, false);
});

test('allows only the deliberately selected player and restores grey on pause', async t => {
  const f = fixture(t);
  f.trusted(f.play('a'));
  await f.video('a').play();
  assert.equal(f.video('a').dataset.htPlaying, 'true');
  assert.equal(f.document.querySelector('#a').dataset.htState, 'playing');
  await assert.rejects(f.video('b').play(), { name: 'NotAllowedError' });
  f.trusted(f.play('a'));
  assert.equal(f.video('a').paused, false, 'capture must not reverse the native pause toggle');
  f.video('a').pause();
  assert.equal(f.video('a').dataset.htPlaying, 'false');
  await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
});

test('does not grant autoplay from synthetic clicks, mute, downloads, or another tweet', async t => {
  const f = fixture(t);
  f.play('a').click();
  await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
  for (const selector of ['#a .mute', '#a .download']) {
    f.trusted(f.document.querySelector(selector));
    await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
  }
  f.trusted(f.play('b'));
  await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
  f.trusted(f.play('a'));
  f.advance(1500);
  await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
});

test('starts, resumes, and replays muted while preserving an unmute during playback', async t => {
  const f = fixture(t);
  const video = f.video('a');
  video.muted = false;
  f.trusted(f.play('a'));
  await video.play();
  assert.equal(video.muted, true);
  video.muted = false;
  await video.play();
  assert.equal(video.muted, false, 'repeated play calls must preserve manual unmute');
  video.pause();
  f.trusted(f.play('a'));
  await video.play();
  assert.equal(video.muted, true, 'resume starts muted');
  video.muted = false;
  f.end(video);
  f.trusted(f.play('a'));
  await video.play();
  assert.equal(video.muted, true, 'replay starts muted');
  const audio = f.document.createElement('audio');
  audio.muted = false;
  await audio.play();
  assert.equal(audio.muted, false, 'audio-only elements remain unchanged');
});

test('accepts the compact Play button alongside a large circular Play overlay', async t => {
  const f = fixture(t);
  const player = f.document.querySelector('#a');
  const overlay = f.document.createElement('button');
  overlay.innerHTML = '<svg><circle cx="30" cy="30" r="30"></circle></svg>';
  player.prepend(overlay);
  f.trusted(f.play('a'));
  await f.video('a').play();
  assert.equal(f.video('a').paused, false);
  f.video('a').pause();
  f.trusted(overlay);
  await f.video('a').play();
  assert.equal(f.video('a').paused, false);
  f.video('a').pause();
  f.trusted(player.querySelector('.mute'));
  await assert.rejects(f.video('a').play(), { name: 'NotAllowedError' });
});

test('keeps X’s sound and replay controls in sync with the protected video', async t => {
  const f = fixture(t);
  const video = f.video('a');
  const player = f.document.querySelector('#a');
  const track = { shouldLoop: true };
  const controls = { muted: false, playing: false };
  const render = () => { video.muted = controls.muted; };
  player.__reactFiber$test = { return: { stateNode: { videoPlayer: {
    video: { getVideoTag: () => video, getCurrentTrack: () => track, shouldLoop: true },
    mute() { queueMicrotask(() => { controls.muted = true; render(); }); },
    pause() { queueMicrotask(() => { controls.playing = false; video.pause(); }); },
  } } } };
  // Model X restoring its stored preference after volume/playing updates.
  video.addEventListener('playing', () => queueMicrotask(render));
  f.trusted(f.play('a'));
  controls.playing = true;
  await video.play();
  await f.settle();
  assert.equal(video.muted, true, 'X must not restore its previous unmuted preference');
  assert.equal(controls.muted, true, 'the native sound button must agree');
  assert.equal(track.shouldLoop, false, 'X must use its normal ended/replay UI');
  controls.muted = false;
  render();
  await video.play();
  await f.settle();
  assert.equal(video.muted, false, 'a manual unmute survives subsequent renders');
  f.end(video);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  await f.settle();
  assert.equal(controls.playing, false);
});

test('accepts the small Replay control beside a text Watch again overlay', async t => {
  const f = fixture(t);
  const player = f.document.querySelector('#a');
  const overlay = f.document.createElement('button');
  overlay.textContent = 'Watch again';
  player.prepend(overlay);
  f.play('a').innerHTML = '<svg viewBox="0 0 24 24"><path d="M0 0"></path></svg>';
  f.end(f.video('a'));
  f.trusted(f.play('a'));
  await f.video('a').play();
  assert.equal(f.video('a').paused, false);
  assert.equal(f.video('a').currentTime, 0);
});

test('never changes another player’s local controls and tolerates missing X internals', async t => {
  const f = fixture(t);
  const a = f.video('a');
  let calls = 0;
  f.document.querySelector('#a').__reactFiber$test = { stateNode: { videoPlayer: {
    video: { getVideoTag: () => f.video('b') }, mute() { calls++; }, pause() { calls++; },
  } } };
  f.trusted(f.play('a'));
  await a.play();
  assert.equal(calls, 0);
  assert.equal(a.muted, true);
});

test('stops native and JavaScript loops but lets a deliberate Replay start again', async t => {
  const f = fixture(t);
  const video = f.video('a');
  f.trusted(f.play('a'));
  await video.play();
  f.end(video);
  video.currentTime = 0;
  assert.equal(video.currentTime, 10);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  assert.equal(video.dataset.htPlaying, 'false');
  f.trusted(f.play('a'));
  video.currentTime = 0;
  await video.play();
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, false);
  // Framework loops that rewind just before the ended event are blocked too.
  f.data(video).time = 9.9;
  video.currentTime = 0;
  assert.equal(video.currentTime, 9.9);
  assert.equal(video.paused, true);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
});

test('allows manual scrubbing near the end without treating it as an automatic loop', async t => {
  const f = fixture(t);
  const video = f.video('a');
  const slider = f.document.querySelector('#a [role="slider"]');
  f.trusted(f.play('a'));
  await video.play();
  f.data(video).time = 9.9;
  f.trusted(slider, 'pointerdown');
  f.advance(3000);
  video.currentTime = 0;
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, false);
  f.trusted(slider, 'pointerup');
  f.advance(1000);
  f.data(video).time = 9.9;
  video.fastSeek(0);
  assert.equal(video.currentTime, 9.9);
  assert.equal(video.paused, true);
});

test('handles keyboard play, buffering, and source reuse', async t => {
  const f = fixture(t);
  const video = f.video('a');
  f.trusted(f.play('a'), 'keydown', { key: 'Enter' });
  await video.play();
  video.dispatchEvent(new f.window.Event('waiting'));
  assert.equal(video.dataset.htPlaying, 'false');
  video.dispatchEvent(new f.window.Event('playing'));
  assert.equal(video.dataset.htPlaying, 'true');
  video.src = 'new-post.mp4';
  await f.settle();
  assert.equal(video.paused, true);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
});

test('supports a player mounted by a Play click, without losing intent during metadata loading', async t => {
  const f = fixture(t, '<div data-testid="videoComponent" id="lazy"><button class="play">Play</button></div>');
  f.trusted(f.play('lazy'));
  const video = f.document.createElement('video');
  f.document.querySelector('#lazy').append(video);
  await f.settle();
  video.src = 'loaded-after-click.mp4';
  video.dispatchEvent(new f.window.Event('loadstart'));
  video.dispatchEvent(new f.window.Event('loadedmetadata'));
  await video.play();
  assert.equal(video.paused, false);
});

test('catches a native autoplay event and protects dynamically inserted videos', async t => {
  const f = fixture(t);
  const video = f.video('a');
  f.data(video).paused = false;
  video.dispatchEvent(new f.window.Event('play'));
  assert.equal(video.paused, true);
  f.document.body.insertAdjacentHTML('beforeend', markup('new'));
  await f.settle();
  assert.equal(f.video('new').autoplay, false);
  assert.equal(f.video('new').loop, false);
  await assert.rejects(f.video('new').play(), { name: 'NotAllowedError' });
});

test('settings independently restore autoplay, loops, sound, and inactive styling', async t => {
  const f = fixture(t);
  const update = value => f.document.dispatchEvent(new f.window.CustomEvent('ht-settings', { detail: JSON.stringify(value) }));
  update({ preventAutoplay: false, preventLoop: false, startMuted: false, greyPaused: false });
  const video = f.video('a'); video.muted = false;
  assert.equal(video.autoplay, true, 'restores the native requested flag');
  assert.equal(video.loop, true);
  await video.play();
  assert.equal(video.muted, false);
  assert.equal(f.document.documentElement.dataset.htGrey, 'false');
  f.data(video).time = 9.9; video.currentTime = 0;
  assert.equal(video.currentTime, 0, 'loop protection can be turned off');
  update({ preventAutoplay: false, preventLoop: true });
  f.end(video);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  f.trusted(f.play('a')); await video.play();
  assert.equal(video.muted, true);
  update({}); video.pause();
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  assert.equal(video.loop, false); assert.equal(video.autoplay, false);
  assert.equal(f.document.documentElement.dataset.htGrey, 'true');
});

test('turning off loop prevention permits X replay after an authorized start', async t => {
  const f = fixture(t);
  f.document.dispatchEvent(new f.window.CustomEvent('ht-settings', { detail: JSON.stringify({ preventLoop: false }) }));
  f.trusted(f.play('a')); await f.video('a').play();
  Object.assign(f.data(f.video('a')), { ended: true, paused: true });
  f.video('a').dispatchEvent(new f.window.Event('pause'));
  f.end(f.video('a'));
  f.video('a').currentTime = 0;
  await f.video('a').play();
  assert.equal(f.video('a').paused, false);
  await assert.rejects(f.video('b').play(), { name: 'NotAllowedError' }, 'autoplay is still independently disabled');
});
