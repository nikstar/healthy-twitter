(() => {
  const { normalize, dayKey, formatTime } = HealthyTwitterSettings;
  let settings = normalize(), loaded = false, route = '', pendingHome = false;
  let card, time, scheduled = false, polling = false, lastPoll = 0;
  let usage = { day: dayKey(), milliseconds: 0, active: false }, receivedAt = 0;
  const publish = () => document.dispatchEvent(new CustomEvent('ht-settings', { detail: JSON.stringify(settings) }));
  document.addEventListener('ht-settings-ready', publish);
  function paint() {
    if (!time || card?.hasAttribute('data-error')) return;
    const extra = usage.active && document.visibilityState === 'visible' && document.hasFocus()
      ? Math.min(6000, Math.max(0, performance.now() - receivedAt)) : 0;
    time.textContent = formatTime(usage.day === dayKey() ? usage.milliseconds + extra : 0);
  }
  async function poll(force = false) {
    if (!loaded || !settings.showTimer || polling || (!force && Date.now() - lastPoll < 5000)) return;
    if (document.visibilityState !== 'visible') return;
    lastPoll = Date.now(); polling = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'activity-pulse' });
      if (result?.error || !Number.isFinite(result?.milliseconds)) throw new Error('Timer unavailable');
      usage = result; receivedAt = performance.now();
      card?.removeAttribute('data-error'); paint();
    } catch {
      usage.active = false;
      card?.setAttribute('data-error', '');
      if (time) time.textContent = 'Refresh tab';
    } finally { polling = false; }
  }
  function scan() {
    scheduled = false;
    const path = location.pathname.replace(/\/$/, '');
    if (route !== path) { route = path; pendingHome = path === '/home'; }
    if (!loaded) return;
    if (pendingHome && settings.defaultFollowing) {
      const tabs = [...(document.querySelector('main [role="tablist"]')?.querySelectorAll('[role="tab"]') || [])];
      if (tabs.length >= 2 && tabs.some(tab => tab.getAttribute('aria-selected') === 'true')) {
        pendingHome = false;
        if (tabs[1].getAttribute('aria-selected') !== 'true') tabs[1].click();
      }
    }
    if (!settings.showTimer) { card?.remove(); card = null; time = null; return; }
    if (!document.body) return;
    if (!card) {
      card = document.createElement('aside'); card.className = 'ht-time-card'; card.dataset.htTimerOwned = '';
      card.setAttribute('aria-label', 'Time spent on Twitter today');
      const label = document.createElement('span'); label.textContent = 'TODAY ON TWITTER'; label.className = 'ht-time-label';
      time = document.createElement('strong'); time.setAttribute('role', 'timer'); time.setAttribute('aria-live', 'off');
      const note = document.createElement('span'); note.textContent = 'Active tab time'; note.className = 'ht-time-note';
      card.append(label, time, note); paint();
    }
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    const host = sidebar || document.body;
    card.classList.toggle('ht-time-floating', !sidebar);
    if (card.parentElement !== host) host.prepend(card);
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }
  function apply(value) {
    const old = settings; settings = normalize(value); loaded = true;
    if (!old.defaultFollowing && settings.defaultFollowing && location.pathname.replace(/\/$/, '') === '/home') pendingHome = true;
    publish(); schedule(); poll(true);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });
  chrome.storage.local.get('settings').then(result => apply(result.settings)).catch(() => apply());
  new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('[data-ht-timer-owned]') &&
      (record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.matches('[data-ht-timer-owned]')) || [...record.removedNodes].some(node => node.nodeType === 1 && node.matches('[data-ht-timer-owned]'))))) schedule();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  // Do not override an explicit tab choice while the home view is still loading.
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target.closest?.('[role="tab"]')) pendingHome = false;
  }, true);
  window.addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', () => { usage.active = false; poll(true); schedule(); });
  window.addEventListener('focus', () => poll(true));
  window.addEventListener('blur', () => { paint(); usage.active = false; });
  setInterval(() => { if (route !== location.pathname.replace(/\/$/, '')) schedule(); paint(); poll(); }, 1000);
  scan();
})();
