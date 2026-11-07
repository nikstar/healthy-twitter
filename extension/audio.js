// MAIN world, before playback.js. Keep media quiet before the browser builds
// its audio renderer; muting only inside play() can already be too late.
(() => {
  const key = Symbol.for('healthy-twitter.audio');
  if (window[key]) return;
  const config = window[Symbol.for('healthy-twitter.settings')];
  const enabled = () => config?.value.preventBackgroundAudio !== false;
  const media = HTMLMediaElement.prototype;
  const muted = Object.getOwnPropertyDescriptor(media, 'muted');
  const defaultMuted = Object.getOwnPropertyDescriptor(media, 'defaultMuted');
  const preload = Object.getOwnPropertyDescriptor(media, 'preload');
  const nativePlay = media.play, nativePause = media.pause, nativeLoad = media.load;
  const setAttribute = Element.prototype.setAttribute;
  const removeAttribute = Element.prototype.removeAttribute;
  const states = new WeakMap(), trackedMedia = new Set(), contexts = new Set();
  let routeContext = () => {};
  const now = () => performance.now();
  const isMedia = node => node instanceof HTMLMediaElement;
  const quiet = element => {
    if (!muted.get.call(element)) muted.set.call(element, true);
    if (!defaultMuted.get.call(element)) defaultMuted.set.call(element, true);
  };
  function stateFor(element) {
    let state = states.get(element);
    if (!state) {
      state = { allowed: false, intent: 0, playIntent: 0, started: false, loadRequested: false,
        wantedMuted: muted.get.call(element), wantedDefaultMuted: defaultMuted.get.call(element), wantedPreload: preload.get.call(element) };
      states.set(element, state); trackedMedia.add(new WeakRef(element));
    }
    if (enabled()) {
      if (!state.allowed) quiet(element);
      if (!state.started && preload.get.call(element) !== 'none') preload.set.call(element, 'none');
    }
    return state;
  }
  function reset(element) {
    const state = stateFor(element);
    state.allowed = false; state.intent = 0; state.playIntent = 0;
    if (enabled()) quiet(element);
    routeContexts();
  }
  function beginPlayback(element, explicit, startMuted) {
    const state = stateFor(element);
    if (explicit) state.playIntent = now() + 1500;
    // A deliberately audible start is possible when Start muted is disabled.
    // Automatic retries and unrelated clicks cannot grant sound permission.
    if (enabled() && explicit && !startMuted && !state.wantedMuted) {
      state.allowed = true; muted.set.call(element, false);
    }
  }
  window[key] = { beginPlayback };

  for (const method of ['createElement', 'createElementNS']) {
    const native = Document.prototype[method];
    Document.prototype[method] = function(...args) {
      const result = native.apply(this, args);
      if (isMedia(result)) stateFor(result);
      return result;
    };
  }
  for (const property of ['src', 'srcObject']) {
    const descriptor = Object.getOwnPropertyDescriptor(media, property);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(media, property, { ...descriptor, set(value) {
      const state = stateFor(this);
      if (descriptor.get.call(this) !== value) {
        reset(this); state.started = false; stateFor(this);
      }
      descriptor.set.call(this, value);
    } });
  }
  Object.defineProperty(media, 'muted', { ...muted, set(value) {
    const state = stateFor(this); state.wantedMuted = !!value;
    if (!value && state.intent > now()) { state.allowed = true; state.intent = 0; }
    if (value) { state.allowed = false; state.intent = 0; }
    muted.set.call(this, enabled() && !state.allowed ? true : value);
    routeContexts();
  } });
  Object.defineProperty(media, 'defaultMuted', { ...defaultMuted, set(value) {
    const state = stateFor(this); state.wantedDefaultMuted = !!value;
    defaultMuted.set.call(this, enabled() && !state.allowed ? true : value);
  } });
  Object.defineProperty(media, 'preload', { ...preload, set(value) {
    const state = stateFor(this); state.wantedPreload = value;
    preload.set.call(this, enabled() && !state.started ? 'none' : value);
  } });
  Element.prototype.setAttribute = function(name, value) {
    if (isMedia(this)) {
      const state = stateFor(this), attribute = String(name).toLowerCase();
      if (attribute === 'preload') { this.preload = value; return; }
      if (attribute === 'src' && this.getAttribute('src') !== String(value)) {
        reset(this); state.started = false; stateFor(this);
      }
    }
    return setAttribute.call(this, name, value);
  };
  Element.prototype.removeAttribute = function(name) {
    if (isMedia(this)) {
      const attribute = String(name).toLowerCase(), state = stateFor(this);
      if (attribute === 'muted') {
        state.wantedDefaultMuted = false;
        if (enabled() && !state.allowed) return;
      }
      if (attribute === 'preload') {
        state.wantedPreload = '';
        if (enabled() && !state.started) return;
      }
    }
    return removeAttribute.call(this, name);
  };
  media.load = function(...args) {
    const state = stateFor(this);
    if (enabled() && !state.started) { state.loadRequested = true; return; }
    return nativeLoad.apply(this, args);
  };
  media.play = function(...args) {
    const state = stateFor(this);
    if (enabled() && this instanceof HTMLAudioElement && !state.allowed) {
      if (state.playIntent <= now()) return Promise.reject(new DOMException('Healthy Twitter: explicitly start audio first.', 'NotAllowedError'));
      state.allowed = true; muted.set.call(this, false);
    }
    state.started = true;
    preload.set.call(this, state.wantedPreload || 'auto');
    if (state.loadRequested) { state.loadRequested = false; nativeLoad.call(this); }
    return nativePlay.apply(this, args);
  };
  const NativeAudio = window.Audio;
  if (NativeAudio) {
    const initialize = (element, args) => { stateFor(element); if (args.length) element.src = args[0]; return element; };
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args, newTarget) { return initialize(Reflect.construct(target, [], newTarget), args); },
      apply(target, receiver, args) { return initialize(Reflect.apply(target, receiver, []), args); },
    });
  }

  function soundControl(target, player) {
    // Find the single-button volume slot around a slider. The progress slider's
    // ancestor either has no buttons or the whole multi-button control bar.
    for (const slider of player.querySelectorAll('[role="slider"]')) {
      for (let node = slider.parentElement; node && node !== player; node = node.parentElement) {
        const buttons = [...node.querySelectorAll('button,[role="button"]')].filter(button => !button.closest('[data-xvs-owned]'));
        if (!buttons.length) continue;
        if (buttons.length === 1 && node.querySelectorAll('[role="slider"]').length === 1 && node.contains(target)) return true;
        break;
      }
    }
    return false;
  }
  function gesture(event) {
    if (!event.isTrusted || event.repeat || (event.type === 'pointerdown' && event.button !== 0) || !(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('[data-xvs-owned],a,input,textarea,select,[contenteditable="true"]')) return;
    if (event.type === 'keydown' && !['m', 'M', ' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (target instanceof HTMLAudioElement && target.controls) {
      const state = stateFor(target); state.playIntent = now() + 1500; state.intent = now() + 1500;
      return;
    }
    const player = target.closest('[data-testid="videoComponent"]');
    const video = target instanceof HTMLVideoElement ? target : player?.querySelector('video');
    if (video && ((target === video && video.controls) || (player && (soundControl(target, player) ||
      (event.type === 'keydown' && ['m', 'M'].includes(event.key)))))) stateFor(video).intent = now() + 1500;
  }
  for (const type of ['pointerdown', 'click', 'keydown']) document.addEventListener(type, gesture, true);
  for (const type of ['pause', 'ended', 'emptied']) document.addEventListener(type, event => {
    if (isMedia(event.target) && !(type === 'emptied' && states.get(event.target)?.playIntent > now())) reset(event.target);
  }, true);
  document.addEventListener('play', event => {
    const element = event.target;
    if (!enabled() || !(element instanceof HTMLAudioElement)) return;
    const state = stateFor(element);
    if (!state.allowed && state.playIntent > now()) {
      state.allowed = true; muted.set.call(element, false);
    } else if (!state.allowed) nativePause.call(element);
  }, true);
  document.addEventListener('playing', event => {
    if (isMedia(event.target) && states.has(event.target)) states.get(event.target).playIntent = 0;
  }, true);
  document.addEventListener('volumechange', event => {
    if (isMedia(event.target)) {
      const state = states.get(event.target);
      // Browser-native controls can bypass JavaScript property setters.
      if (state?.intent > now() && !muted.get.call(event.target)) { state.allowed = true; state.intent = 0; }
      stateFor(event.target); routeContexts();
    }
  }, true);

  // Use Chrome's no-output sink from construction, not suspend() after creating
  // a hardware-backed context. Audio graphs/decoding can work without a device.
  const NativeContext = window.AudioContext;
  if (NativeContext && typeof NativeContext.prototype.setSinkId === 'function') {
    const nativeSink = NativeContext.prototype.setSinkId;
    const nativeSource = NativeContext.prototype.createMediaElementSource;
    const nativeClose = NativeContext.prototype.close;
    const records = new WeakMap();
    const ProxyContext = new Proxy(NativeContext, { construct(target, args, newTarget) {
      const options = args[0] || {};
      const context = Reflect.construct(target, [enabled() ? { ...options, sampleRate: options.sampleRate ?? 48000, sinkId: { type: 'none' } } : options], newTarget);
      const entry = { context, wanted: options.sinkId ?? '', sources: new Set(), queue: Promise.resolve(), silent: enabled() };
      records.set(context, entry); entry.ref = new WeakRef(entry); contexts.add(entry.ref);
      context.addEventListener('statechange', () => { if (context.state === 'closed') contexts.delete(entry.ref); });
      return context;
    } });
    window.AudioContext = ProxyContext;
    if (window.webkitAudioContext === NativeContext) window.webkitAudioContext = ProxyContext;
    const permitted = entry => !enabled() || [...entry.sources].some(element => {
      const state = states.get(element);
      return state?.allowed && !element.paused && !muted.get.call(element) && element.volume > 0;
    });
    function route(entry, force = false) {
      const silent = !permitted(entry);
      if (!force && entry.silent === silent) return entry.queue;
      entry.silent = silent;
      entry.queue = entry.queue.catch(() => {}).then(() => {
        if (entry.context.state === 'closed') return;
        return nativeSink.call(entry.context, permitted(entry) ? entry.wanted : { type: 'none' });
      });
      // Internal routing failures must not become unhandled rejections.
      entry.queue.catch(() => {});
      return entry.queue;
    }
    NativeContext.prototype.setSinkId = function(value) {
      const entry = records.get(this);
      if (!entry) return nativeSink.call(this, value);
      entry.wanted = value; return route(entry, true);
    };
    NativeContext.prototype.createMediaElementSource = function(element) {
      const source = nativeSource.call(this, element);
      const entry = records.get(this);
      if (entry) { entry.sources.add(element); route(entry); }
      return source;
    };
    NativeContext.prototype.close = function(...args) {
      const entry = records.get(this); if (entry) contexts.delete(entry.ref);
      return nativeClose.apply(this, args);
    };
    for (const type of ['playing', 'pause', 'volumechange']) document.addEventListener(type, routeContexts, true);
    routeContext = route;
  } else if (NativeContext) {
    // A browser lacking the no-output sink must not silently use hardware.
    const DeferredContext = new Proxy(NativeContext, { construct(target, args, newTarget) {
      if (enabled()) throw new DOMException('Healthy Twitter: silent Web Audio output is unavailable.', 'NotSupportedError');
      return Reflect.construct(target, args, newTarget);
    } });
    window.AudioContext = DeferredContext;
    if (window.webkitAudioContext === NativeContext) window.webkitAudioContext = DeferredContext;
  }
  function routeContexts() {
    for (const ref of contexts) {
      const entry = ref.deref();
      if (entry) routeContext(entry); else contexts.delete(ref);
    }
  }
  function applySettings() {
    for (const ref of trackedMedia) {
      const element = ref.deref();
      if (!element) { trackedMedia.delete(ref); continue; }
      const state = stateFor(element);
      if (!enabled()) {
        preload.set.call(element, state.wantedPreload);
        defaultMuted.set.call(element, state.wantedDefaultMuted);
        muted.set.call(element, state.wantedMuted);
        if (state.loadRequested) { state.loadRequested = false; nativeLoad.call(element); }
      }
    }
    routeContexts();
  }
  config?.subscribe(applySettings);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (isMedia(node)) stateFor(node);
      node.querySelectorAll?.('video,audio').forEach(stateFor);
    }
  }).observe(document, { childList: true, subtree: true });
  document.querySelectorAll('video,audio').forEach(stateFor);
})();
