// X's immersive viewer subscribes to tracksFinished and advances its scroller
// when this feature flag is true. Disable that one policy, not scrolling or
// ended events: manual swipes, navigation, and the player's end UI stay native.
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
