// Shared by classic content scripts and extension module pages. No page storage.
(() => {
  const defaults = Object.freeze({
    defaultFollowing: true, showTimer: true,
    preventBackgroundAudio: true, preventAutoplay: true, preventLoop: true, startMuted: true, greyPaused: true,
    showNotInterested: true, showLessAccount: true, showBlock: true,
    playerDownload: true, menuDownload: true,
  });
  const normalize = value => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
    [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
  const dayKey = (time = Date.now()) => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const formatTime = milliseconds => {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  globalThis.HealthyTwitterSettings = Object.freeze({ defaults, normalize, dayKey, formatTime });
})();
