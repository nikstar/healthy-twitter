import './settings.js';
import { isTwitterPage } from './shared.js';
const { dayKey } = globalThis.HealthyTwitterSettings;

// Single worker owns the total: multiple tabs/windows can never add it twice.
// A heartbeat gap over 15 seconds is treated as suspension, not browsing time.
export class DailyLedger {
  constructor(saved, now) {
    this.day = dayKey(now);
    this.milliseconds = saved?.day === this.day && Number.isFinite(saved.milliseconds) ? Math.max(0, saved.milliseconds) : 0;
    this.last = now;
    this.active = false;
  }
  settle(now) {
    if (now < this.last) return this.snapshot();
    const elapsed = now - this.last;
    const today = dayKey(now);
    if (today !== this.day) { this.day = today; this.milliseconds = 0; }
    if (this.active && elapsed > 0 && elapsed <= 15000) {
      const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
      this.milliseconds += Math.max(0, now - Math.max(this.last, midnight.getTime()));
    }
    this.last = now;
    return this.snapshot();
  }
  snapshot() { return { day: this.day, milliseconds: this.milliseconds }; }
}

export function installActivity(chrome) {
  let ledger, enabled = true, owner = null;
  let queue = Promise.resolve();
  const serialize = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  async function init(now) {
    if (ledger) return;
    const saved = await chrome.storage.local.get(['dailyUsage', 'settings']);
    ledger = new DailyLedger(saved.dailyUsage, now);
    enabled = globalThis.HealthyTwitterSettings.normalize(saved.settings).showTimer;
  }
  async function activeTab() {
    try {
      const window = await chrome.windows.getLastFocused();
      if (!window.focused || window.state === 'minimized') return null;
      const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
      return tab && isTwitterPage(tab.url) ? tab.id : null;
    } catch { return null; } // No remaining window, or one closed during the query.
  }
  async function save() { await chrome.storage.local.set({ dailyUsage: ledger.snapshot() }); }
  async function refresh(now, senderTab = null) {
    await init(now);
    ledger.settle(now);
    owner = enabled ? await activeTab() : null;
    ledger.active = owner !== null;
    await save();
    return { ...ledger.snapshot(), active: enabled && owner === senderTab };
  }
  const transition = () => {
    const now = Date.now();
    serialize(() => refresh(now)).catch(() => {});
  };
  chrome.tabs.onActivated.addListener(transition);
  chrome.tabs.onRemoved.addListener(transition);
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === owner && (change.url || change.status)) transition(); });
  chrome.windows.onFocusChanged.addListener(transition);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const now = Date.now();
    serialize(async () => {
      await init(now);
      ledger.settle(now);
      enabled = globalThis.HealthyTwitterSettings.normalize(changes.settings.newValue).showTimer;
      owner = enabled ? await activeTab() : null;
      ledger.active = owner !== null;
      await save();
    }).catch(() => {});
  });
  return {
    pulse(sender) { const now = Date.now(); return serialize(() => refresh(now, sender.tab.id)); },
    getUsage() { const now = Date.now(); return serialize(() => refresh(now)); },
  };
}
