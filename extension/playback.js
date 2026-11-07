// Runs in the page's MAIN world at document_start, before X's player starts.
// No extension APIs, network access, or account data are used here.
(() => {
  const installed = Symbol.for('healthy-twitter.playback');
  if (window[installed]) return;
  window[installed] = true;

  const config = window[Symbol.for('healthy-twitter.settings')];
  const enabled = key => config?.value[key] !== false;
  const requestedFlags = new WeakMap();
  const nativeLoops = new WeakMap();
  const PLAYER = '[data-testid="videoComponent"]';
  const mediaPrototype = HTMLMediaElement.prototype;
  const nativePlay = mediaPrototype.play;
  const nativePause = mediaPrototype.pause;
  const timeProperty = Object.getOwnPropertyDescriptor(mediaPrototype, 'currentTime');
  const nativeFastSeek = mediaPrototype.fastSeek;
  const states = new WeakMap();
  const pendingPlayers = new WeakMap();
  let scrubbing = null;
  const now = () => performance.now();
  const isVideo = element => element instanceof HTMLVideoElement;
  const sourceOf = video => video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || video.currentSrc || '';

  function paint(video, playing) {
    video.setAttribute('data-ht-playing', String(playing));
    video.closest(PLAYER)?.setAttribute('data-ht-state', playing ? 'playing' : 'paused');
  }

  function flagsOff(video) {
    let flags = requestedFlags.get(video);
    if (!flags) { flags = {}; requestedFlags.set(video, flags); }
    for (const [name, setting] of [['autoplay', 'preventAutoplay'], ['loop', 'preventLoop']]) {
      if (video.hasAttribute(name)) flags[name] = true;
      if (enabled(setting) && video.hasAttribute(name)) video.removeAttribute(name);
    }
  }

  function syncPlayer(video, action) {
    // X keeps its own mute/play state and reapplies it on every render.
    // Use only this video's local control API, so the native controls agree
    // with the media element. This never calls an account or network API.
    const player = video.closest(PLAYER);
    if (!player) return;
    try {
      const key = Object.keys(player).find(key => key.startsWith('__reactFiber$'));
      let fiber = key && player[key];
      for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
        const api = fiber.stateNode?.videoPlayer;
        if (api?.video?.getVideoTag?.() === video && (!action || typeof api[action] === 'function')) {
          // The short-video loop setting also controls X's ended/replay UI.
          // Disable it for this mounted track; the native guard remains the
          // fallback for players without this integration.
          const track = api.video.getCurrentTrack?.();
          for (const object of [track, api.video]) {
            if (!object || Object.isFrozen(object)) continue;
            if (!nativeLoops.has(object)) nativeLoops.set(object, object.shouldLoop);
            object.shouldLoop = enabled('preventLoop') ? false : nativeLoops.get(object);
          }
          if (action) api[action]();
          return;
        }
      }
    } catch { /* Native media protection still works if X changes its API. */ }
  }

  function stateFor(video) {
    let state = states.get(video);
    if (!state) {
      const pending = pendingPlayers.get(video.closest(PLAYER)) || 0;
      state = { allowed: false, intentUntil: pending, seekUntil: 0, finished: false, source: sourceOf(video) };
      states.set(video, state);
      flagsOff(video);
      paint(video, false);
    }
    const source = sourceOf(video);
    if (source !== state.source) {
      // An empty player may receive its first source as part of a Play click.
      // A recycled element with a different source always needs a new click.
      if (state.source) {
        state.allowed = false;
        state.finished = false;
        if (state.intentUntil < now()) state.intentUntil = 0;
        paint(video, false);
      }
      state.source = source;
    }
    return state;
  }

  function stop(video, finished = false) {
    const state = stateFor(video);
    state.allowed = false;
    state.intentUntil = 0;
    state.finished ||= finished;
    if (!video.paused) nativePause.call(video);
    paint(video, false);
  }

  function canSeek(video, value) {
    if (!enabled('preventLoop')) return true;
    const state = stateFor(video);
    const manual = state.intentUntil > now() || state.seekUntil > now() || scrubbing === video;
    const current = timeProperty.get.call(video);
    const nearEnd = Number.isFinite(video.duration) && current >= video.duration - 0.4;
    // X loops GIFs by seeking backwards and calling play(), even with loop=false.
    // Keep the last frame when that happens; manual seeks and Replay still work.
    if (!manual && (state.finished || (state.allowed && nearEnd && current > 0.5 && Number(value) < current - 0.5))) {
      stop(video, true);
      return false;
    }
    if (manual) state.finished = false;
    return true;
  }

  Object.defineProperty(mediaPrototype, 'play', {
    configurable: true, writable: true,
    value: function(...args) {
      if (!isVideo(this)) return nativePlay.apply(this, args);
      const state = stateFor(this);
      flagsOff(this);
      if (!state.allowed && state.intentUntil <= now() && (enabled('preventAutoplay') || (enabled('preventLoop') && state.finished))) {
        stop(this);
        syncPlayer(this, 'pause');
        return Promise.reject(new DOMException('Healthy Twitter: press Play to start this video.', 'NotAllowedError'));
      }
      // Every new start, resume, or replay begins quietly. Repeated play()
      // calls during playback must preserve an intentional unmute.
      syncPlayer(this);
      if (enabled('startMuted') && (!state.allowed || this.paused || this.ended)) {
        this.muted = true;
        syncPlayer(this, 'mute');
      }
      state.allowed = true;
      state.intentUntil = 0;
      state.finished = false;
      return nativePlay.apply(this, args).catch(error => {
        stop(this);
        throw error;
      });
    },
  });
  Object.defineProperty(mediaPrototype, 'pause', {
    configurable: true, writable: true,
    value: function(...args) {
      if (isVideo(this) && !(this.ended && !enabled('preventLoop') && stateFor(this).allowed)) {
        const state = stateFor(this);
        state.allowed = false;
        state.intentUntil = 0;
        paint(this, false);
      }
      return nativePause.apply(this, args);
    },
  });
  for (const property of ['autoplay', 'loop']) {
    const descriptor = Object.getOwnPropertyDescriptor(mediaPrototype, property);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(HTMLVideoElement.prototype, property, {
      ...descriptor,
      set(value) {
        let flags = requestedFlags.get(this);
        if (!flags) { flags = {}; requestedFlags.set(this, flags); }
        flags[property] = !!value;
        descriptor.set.call(this, enabled(property === 'loop' ? 'preventLoop' : 'preventAutoplay') ? false : value);
      },
    });
  }
  if (timeProperty?.set && timeProperty.configurable) {
    Object.defineProperty(mediaPrototype, 'currentTime', {
      ...timeProperty,
      set(value) {
        if (!isVideo(this) || canSeek(this, value)) timeProperty.set.call(this, value);
      },
    });
  }
  if (nativeFastSeek) {
    Object.defineProperty(mediaPrototype, 'fastSeek', {
      configurable: true, writable: true,
      value: function(value) {
        if (!isVideo(this) || canSeek(this, value)) return nativeFastSeek.call(this, value);
      },
    });
  }

  function playerFor(event) {
    if (!(event.target instanceof Element)) return null;
    const player = event.target.closest(PLAYER);
    const video = isVideo(event.target) ? event.target : player?.querySelector('video');
    return player || video ? { player, video } : null;
  }

  function gesture(event) {
    if (!event.isTrusted || event.repeat || (event.type === 'click' && event.button !== 0)) return;
    const found = playerFor(event);
    if (!found || event.target.closest('[data-xvs-owned], a, input, textarea, select, [contenteditable="true"]')) return;
    const { player, video } = found;
    const slider = event.target.closest('[role="slider"]');
    if (slider) {
      if (video) stateFor(video).seekUntil = now() + 1500;
      return;
    }
    if (event.type === 'keydown' && ![' ', 'Spacebar', 'Enter', 'k', 'K'].includes(event.key)) return;
    const button = event.target.closest('button, [role="button"]');
    if (button && player) {
      // Paused players can show both a large circular Play overlay and a
      // smaller Play/Pause control. Accept either, independently of language.
      const buttons = [...player.querySelectorAll('button, [role="button"]')].filter(element => !element.closest('[data-xvs-owned]'));
      const control = buttons.find(element => element.querySelector('svg[viewBox="0 0 24 24"]')) ||
        buttons.find(element => !element.querySelector('svg circle'));
      if (button !== buttons[0] && button !== control) return;
    }
    if (video && !video.paused && !video.ended) {
      // Let X perform its normal Pause toggle. Changing paused in the capture
      // phase would make a native toggle mistake this click for Play instead.
      return;
    }
    const until = now() + 1200;
    if (player) pendingPlayers.set(player, until);
    if (video) stateFor(video).intentUntil = until;
  }
  document.addEventListener('click', gesture, true);
  document.addEventListener('keydown', gesture, true);
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('[role="slider"]')) return;
    const video = playerFor(event)?.video;
    if (video) { scrubbing = video; stateFor(video).seekUntil = now() + 1500; }
  }, true);
  const finishScrub = () => {
    if (scrubbing) stateFor(scrubbing).seekUntil = now() + 500;
    scrubbing = null;
  };
  document.addEventListener('pointerup', finishScrub, true);
  document.addEventListener('pointercancel', finishScrub, true);

  for (const type of ['play', 'playing']) {
    document.addEventListener(type, event => {
      if (!isVideo(event.target)) return;
      const video = event.target;
      const state = stateFor(video);
      if (!state.allowed && !enabled('preventAutoplay') && !(enabled('preventLoop') && state.finished)) {
        if (enabled('startMuted')) { video.muted = true; syncPlayer(video, 'mute'); }
        state.allowed = true;
      }
      if (!state.allowed) stop(video);
      else if (type === 'playing' && !video.paused) paint(video, true);
    }, true);
  }
  document.addEventListener('pause', event => {
    if (isVideo(event.target) && event.target.paused) {
      if (event.target.ended && !enabled('preventLoop') && stateFor(event.target).allowed) paint(event.target, false);
      else stop(event.target);
    }
  }, true);
  document.addEventListener('ended', event => {
    if (isVideo(event.target)) {
      if (enabled('preventLoop')) stop(event.target, true);
      else paint(event.target, false);
    }
  }, true);
  document.addEventListener('waiting', event => {
    if (isVideo(event.target)) paint(event.target, false);
  }, true);
  document.addEventListener('error', event => {
    if (isVideo(event.target)) stop(event.target);
  }, true);
  for (const type of ['loadstart', 'loadedmetadata', 'emptied']) {
    document.addEventListener(type, event => {
      if (!isVideo(event.target)) return;
      const video = event.target;
      flagsOff(video);
      if (enabled('preventAutoplay') && !stateFor(video).allowed) {
        // Loading a source can be part of a pending, explicit Play action.
        // Pause any native autoplay without consuming that short-lived intent.
        if (!video.paused) nativePause.call(video);
        paint(video, false);
      }
    }, true);
  }

  function observeVideo(video) {
    const state = stateFor(video);
    flagsOff(video);
    if (enabled('preventAutoplay') && !state.allowed && !video.paused) stop(video);
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const video = isVideo(record.target) ? record.target : record.target.closest('video');
        if (video) observeVideo(video);
      } else {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (isVideo(node)) observeVideo(node);
          node.querySelectorAll('video').forEach(observeVideo);
        }
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['autoplay', 'loop', 'src'] });
  function applySettings() {
    document.documentElement?.setAttribute('data-ht-grey', String(enabled('greyPaused')));
    document.querySelectorAll('video').forEach(video => {
      const flags = requestedFlags.get(video) || {};
      for (const [name, setting] of [['autoplay', 'preventAutoplay'], ['loop', 'preventLoop']]) {
        if (!enabled(setting) && flags[name]) video[name] = true;
      }
      if (!enabled('preventLoop')) stateFor(video).finished = false;
      flagsOff(video); syncPlayer(video);
    });
  }
  config?.subscribe(applySettings);
  document.addEventListener('DOMContentLoaded', applySettings, { once: true });
  document.querySelectorAll('video').forEach(observeVideo);
  applySettings();
})();
