// One instance in each JavaScript world. Only boolean display/behavior settings
// cross the page boundary; preferences can only be persisted by extension UI.
(() => {
  const key = Symbol.for('healthy-twitter.settings');
  if (window[key]) return;
  const listeners = new Set();
  const config = { value: { ...HealthyTwitterSettings.defaults }, subscribe: fn => listeners.add(fn) };
  window[key] = config;
  document.addEventListener('ht-settings', event => {
    try {
      config.value = HealthyTwitterSettings.normalize(JSON.parse(event.detail));
      for (const listener of listeners) listener(config.value);
    } catch { /* Ignore malformed page events. */ }
  });
  document.dispatchEvent(new Event('ht-settings-ready'));
})();
