export function isTwitterPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(x\.com|twitter\.com)$/.test(url.hostname);
  } catch { return false; }
}

export function validateVideoURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' || url.port ||
      url.username || url.password || !url.pathname.endsWith('.mp4') ||
      /\/(?:pl|aud)\//.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function videoFilename({ author, postId, index, width, height }) {
  const safeAuthor = String(author || 'x').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30) || 'x';
  const safeId = String(postId || 'video').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 40) || 'video';
  const number = Math.max(1, Math.min(100, (Number(index) || 0) + 1));
  const size = [width, height].every(value => Number.isInteger(value) && value > 0 && value < 20000)
    ? `_${width}x${height}` : '';
  return `${safeAuthor}_${safeId}_${number}${size}.mp4`;
}
