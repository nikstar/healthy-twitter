// X controls automatic advancement through a feature flag. Manual advancement
// uses a native snap scroller, whose overflow is controlled by playback.css.
(() => {
  const key = Symbol.for('healthy-twitter.viewer');
  if (window[key]) return;
  window[key] = true;
  const config = window[Symbol.for('healthy-twitter.settings')];
  const flag = 'explore_relaunch_enable_auto_play';
  const patched = new WeakSet();
  let scheduled = false;

  function scan() {
    scheduled = false;
    // Also runs when the root first appears after document_start.
    document.documentElement?.toggleAttribute('data-ht-allow-viewer-swipes', config?.value.preventViewerSwipes === false);
    const root = document.querySelector('main');
    if (!root) return;
    try {
      const key = Object.keys(root).find(key => key.startsWith('__reactFiber$'));
      let fiber = key && root[key];
      for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
        const switches = fiber.memoizedProps?.value?.featureSwitches;
        if (!switches || patched.has(switches) || typeof switches.getFeatureSwitch !== 'function') continue;
        const original = switches.getFeatureSwitch;
        switches.getFeatureSwitch = function(options, ...args) {
          const result = original.call(this, options, ...args);
          if (options?.name === flag && config?.value.preventAutoAdvance !== false) {
            return { ...result, value: false };
          }
          return result;
        };
        patched.add(switches);
      }
    } catch { /* Do not guess at other flags or change site navigation. */ }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; queueMicrotask(scan); }
  }
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  config?.subscribe(schedule);
  scan();
})();
