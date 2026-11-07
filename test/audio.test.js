import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const sources = await Promise.all(['settings.js','settings-bridge.js','audio.js','playback.js'].map(file => readFile(new URL(`../extension/${file}`, import.meta.url), 'utf8')));
function fixture(t, { playback = true, sinkSupport = true } = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://x.com/home', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const { window } = dom, { document } = window;
  const data = new WeakMap(), calls = [], contexts = [], handlers = new Map();
  const record = element => { if (!data.has(element)) data.set(element, { paused: true, ended: false }); return data.get(element); };
  for (const key of ['paused','ended']) Object.defineProperty(window.HTMLMediaElement.prototype, key, { configurable:true, get() { return record(this)[key]; } });
  window.HTMLMediaElement.prototype.play = function() { calls.push({ type: 'play', muted: this.muted, preload: this.preload }); record(this).paused = false; this.dispatchEvent(new window.Event('play')); this.dispatchEvent(new window.Event('playing')); return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function() { record(this).paused = true; this.dispatchEvent(new window.Event('pause')); };
  window.HTMLMediaElement.prototype.load = function() { calls.push({ type: 'load', muted: this.muted, preload: this.preload }); };
  class Context extends window.EventTarget {
    constructor(options = {}) { super(); this.options = options; this.sinkId = options.sinkId ?? ''; this.state = 'running'; contexts.push(this); }
    async setSinkId(value) { this.sinkId = value; }
    createMediaElementSource(element) { return { mediaElement: element }; }
    async close() { this.state = 'closed'; this.dispatchEvent(new window.Event('statechange')); }
  }
  if (!sinkSupport) delete Context.prototype.setSinkId;
  window.AudioContext = window.webkitAudioContext = Context;
  const add = document.addEventListener.bind(document);
  document.addEventListener = (type, callback, options) => { const list = handlers.get(type) || []; list.push(callback); handlers.set(type, list); add(type, callback, options); };
  const nativeMuted = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype,'muted');
  const nativePlay = window.HTMLMediaElement.prototype.play;
  sources.slice(0, playback ? 4 : 3).forEach(source => window.eval(source));
  const player = document.createElement('div'); player.dataset.testid = 'videoComponent';
  const video = document.createElement('video'); player.append(video);
  player.insertAdjacentHTML('beforeend', '<button class="play">Play</button><div role="slider" class="seek"></div><div class="volume"><button class="mute">Unmute</button><div role="slider"></div></div><div data-xvs-owned><button class="download">Download</button></div>');
  document.body.append(player);
  return { window, document, video, player, calls, contexts, nativeMuted, nativePlay,
    trusted(target, type='click', extra={}) { for(const fn of handlers.get(type)||[]) fn({ target, isTrusted:true, button:0, repeat:false, ...extra }); },
    settings(value) { document.dispatchEvent(new window.CustomEvent('ht-settings',{ detail:JSON.stringify(value) })); },
    settle: () => new Promise(resolve=>setTimeout(resolve,0)),
    data: record,
  };
}

test('new and detached media are muted before src/load and preload stays deferred', t => {
  const f = fixture(t);
  const video = f.document.createElement('video');
  assert.equal(video.muted, true); assert.equal(video.defaultMuted, true); assert.equal(video.preload,'none');
  video.muted = false; video.defaultMuted = false; video.preload = 'auto'; video.src = 'movie.mp4'; video.load();
  assert.equal(video.muted,true); assert.equal(video.preload,'none');
  assert.equal(f.calls.length,0,'background load() is deferred before native initialization');
  video.setAttribute('preload','auto'); video.setAttribute('src','other.mp4'); video.removeAttribute('muted'); video.removeAttribute('preload');
  assert.equal(video.muted,true); assert.equal(video.defaultMuted,true); assert.equal(video.preload,'none');
  const audio = new f.window.Audio('notification.mp3');
  assert.equal(audio.muted,true); assert.equal(audio.preload,'none'); assert.match(audio.src,/notification.mp3$/);
});

test('parser/clone media are protected and autoplay still never reaches native play', async t => {
  const f = fixture(t);
  f.player.insertAdjacentHTML('beforeend','<video src="inserted.mp4" autoplay preload="auto"></video>');
  await f.settle();
  const inserted = f.player.querySelectorAll('video')[1]; assert.equal(inserted.muted,true); assert.equal(inserted.preload,'none');
  await assert.rejects(inserted.play(),{name:'NotAllowedError'}); assert.equal(f.calls.length,0);
  const cloned = inserted.cloneNode(true); f.player.append(cloned); await f.settle(); assert.equal(cloned.muted,true);
});

test('deliberate Play stays silent, only a trusted sound control can unmute, and Pause revokes it', async t => {
  const f = fixture(t);
  f.trusted(f.player.querySelector('.play')); await f.video.play();
  assert.equal(f.calls.at(-1).muted,true); assert.equal(f.video.preload,'auto');
  f.video.muted = false; assert.equal(f.video.muted,true,'render-time unmute is blocked');
  f.player.querySelector('.mute').click(); f.video.muted=false; assert.equal(f.video.muted,true,'synthetic click is insufficient');
  f.trusted(f.player.querySelector('.download')); f.video.muted=false; assert.equal(f.video.muted,true);
  f.trusted(f.player.querySelector('.seek')); f.video.muted=false; assert.equal(f.video.muted,true,'scrubbing grants no audio');
  f.trusted(f.player.querySelector('.mute')); f.video.muted=false; assert.equal(f.video.muted,false);
  await f.video.play(); assert.equal(f.video.muted,false,'keep intentional sound during playback');
  f.video.pause(); assert.equal(f.video.muted,true);
  f.video.muted=false; assert.equal(f.video.muted,true);
  f.trusted(f.player.querySelector('.play')); await f.video.play(); assert.equal(f.video.muted,true);
});

test('sound authorization is scoped to one player and lost on source replacement', async t => {
  const f = fixture(t);
  f.trusted(f.player.querySelector('.mute')); f.video.muted=false; assert.equal(f.video.muted,false);
  const other=f.document.createElement('video'); other.muted=false; assert.equal(other.muted,true);
  f.video.src='new-source.mp4'; assert.equal(f.video.muted,true);
});

test('explicitly audible Play is allowed with Start muted off; audio-only background play is blocked', async t => {
  const f = fixture(t); f.settings({startMuted:false});
  f.video.muted=false;
  f.trusted(f.player.querySelector('.play')); await f.video.play(); assert.equal(f.video.muted,false);
  const audio=new f.window.Audio('notification.mp3'); await assert.rejects(audio.play(),{name:'NotAllowedError'});
  audio.controls=true; f.document.body.append(audio); f.trusted(audio); await audio.play(); assert.equal(audio.muted,false);
  audio.pause(); assert.equal(audio.muted,true);
});

test('Web Audio uses a no-device sink from construction and background setSinkId cannot bypass it', async t => {
  const f=fixture(t);
  const ctx=new f.window.AudioContext({latencyHint:'interactive',sampleRate:44100});
  assert.equal(ctx.options.sinkId.type,'none'); assert.equal(ctx.options.sampleRate,44100);
  assert.equal(ctx.options.latencyHint,'interactive'); assert.equal(ctx instanceof f.window.AudioContext,true);
  await ctx.setSinkId(''); assert.equal(ctx.sinkId.type,'none');
  f.trusted(f.document.body); await ctx.setSinkId('headphones'); assert.equal(ctx.sinkId.type,'none');
  assert.equal(new f.window.webkitAudioContext().options.sinkId.type,'none');
  await ctx.close(); assert.equal(ctx.state,'closed');
});

test('a graph attached to the deliberately unmuted player can use sound, then releases it on pause', async t => {
  const f=fixture(t); const ctx=new f.window.AudioContext(); ctx.createMediaElementSource(f.video);
  f.trusted(f.player.querySelector('.play')); await f.video.play(); await f.settle(); assert.equal(ctx.sinkId.type,'none');
  f.trusted(f.player.querySelector('.mute')); f.video.muted=false; await f.settle(); assert.equal(ctx.sinkId,'');
  f.video.pause(); await f.settle(); assert.equal(ctx.sinkId.type,'none');
});

test('turning protection off restores requested state, including detached audio and Web Audio', async t => {
  const f=fixture(t); const audio=new f.window.Audio(); audio.preload='auto'; audio.muted=false;
  const ctx=new f.window.AudioContext({sinkId:'chosen-output'});
  f.settings({preventBackgroundAudio:false}); await f.settle();
  assert.equal(audio.muted,false); assert.equal(audio.preload,'auto'); assert.equal(ctx.sinkId,'chosen-output');
  await audio.play();
  f.settings({}); await f.settle(); assert.equal(audio.muted,true); assert.equal(ctx.sinkId.type,'none');
});

test('a browser without no-device Web Audio support fails closed before constructing a context', t => {
  const f=fixture(t,{sinkSupport:false});
  assert.throws(()=>new f.window.AudioContext(),{name:'NotSupportedError'}); assert.equal(f.contexts.length,0);
  f.settings({preventBackgroundAudio:false}); new f.window.AudioContext(); assert.equal(f.contexts.length,1);
});


test('a deliberate Play flushes a deferred load while muted', async t => {
  const f=fixture(t); f.video.src='deferred.mp4'; f.video.load();
  assert.equal(f.calls.length,0);
  f.trusted(f.player.querySelector('.play')); await f.video.play();
  assert.equal(f.calls[0].type,'load'); assert.equal(f.calls[0].muted,true);
  assert.equal(f.calls[1].type,'play'); assert.equal(f.calls[1].muted,true);
});


test('native volume controls require a recent sound gesture even when they bypass the JS setter', t => {
  const f=fixture(t); f.video.controls=true;
  f.nativeMuted.set.call(f.video,false); f.video.dispatchEvent(new f.window.Event('volumechange'));
  assert.equal(f.video.muted,true);
  f.trusted(f.video); f.nativeMuted.set.call(f.video,false); f.video.dispatchEvent(new f.window.Event('volumechange'));
  assert.equal(f.video.muted,false);
});

test('native audio controls can deliberately play but an unsolicited native audio start is stopped', async t => {
  const f=fixture(t); const audio=new f.window.Audio(); audio.controls=true; f.document.body.append(audio);
  await f.nativePlay.call(audio); assert.equal(audio.paused,true); assert.equal(audio.muted,true);
  f.trusted(audio); await f.nativePlay.call(audio); assert.equal(audio.paused,false); assert.equal(audio.muted,false);
});
