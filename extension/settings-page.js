// Dedicated MAIN-world entry: Chrome can deduplicate a script path declared
// in both MAIN and ISOLATED entries. Do not share this manifest path.
// The isolated world owns the schema and broadcasts normalized booleans.
(() => {
  const key = Symbol.for('healthy-twitter.settings');
  if (window[key]) return;
  const listeners = new Set();
  // Every current setting defaults on; consumers treat a missing key as on.
  const config = { value: {}, subscribe: fn => listeners.add(fn) };
  window[key] = config;
  document.addEventListener('ht-settings', event => {
    try {
      const value = JSON.parse(event.detail);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      config.value = Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value === 'boolean'));
      for (const listener of listeners) listener(config.value);
    } catch { /* Ignore malformed page events. No storage or commands here. */ }
  });
  document.dispatchEvent(new Event('ht-settings-ready'));
})();
