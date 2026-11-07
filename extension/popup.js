const { defaults, normalize, formatTime, dayKey } = HealthyTwitterSettings;
const form = document.querySelector('#settings');
const status = document.querySelector('#status');
const time = document.querySelector('#today-time');
const inputs = [...form.querySelectorAll('input')];
let settings = normalize(), saving = Promise.resolve(), usage = null;
function render(value) {
  settings = normalize(value);
  inputs.forEach(input => { input.checked = settings[input.name]; });
}
function showUsage(value) {
  if (!value || !Number.isFinite(value.milliseconds)) return;
  usage = value;
  time.textContent = formatTime(value.day === dayKey() ? value.milliseconds : 0);
}
inputs.forEach(input => { input.disabled = true; });
try {
  const stored = await chrome.storage.local.get(['settings', 'dailyUsage']);
  render(stored.settings); showUsage(stored.dailyUsage || { day: dayKey(), milliseconds: 0 });
  inputs.forEach(input => { input.disabled = false; });
  status.textContent = 'Changes apply to open Twitter tabs.';
} catch { status.textContent = 'Couldn’t load settings. Reopen this popup to try again.'; status.className = 'error'; }
form.addEventListener('change', event => {
  const input = event.target;
  if (!(input.name in defaults)) return;
  const key = input.name, value = input.checked;
  status.textContent = 'Saving…'; status.className = '';
  // Read inside the queue so rapid toggles and another popup don't overwrite
  // unrelated preferences with an old snapshot.
  saving = saving.then(async () => {
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...normalize(stored.settings), [key]: value } });
    status.textContent = 'Saved. Changes apply to open Twitter tabs.';
  }).catch(() => {
    status.textContent = 'Couldn’t save. Please try again.'; status.className = 'error';
    input.checked = settings[key];
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) render(changes.settings.newValue);
  if (changes.dailyUsage) showUsage(changes.dailyUsage.newValue);
});
try { showUsage(await chrome.runtime.sendMessage({ type: 'usage-get' })); } catch { /* Last saved total remains visible. */ }
setInterval(() => { if (usage?.day !== dayKey()) time.textContent = formatTime(0); }, 1000);
