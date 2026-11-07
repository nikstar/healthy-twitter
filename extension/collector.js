// Self-contained: Chrome serializes this function into the current page's MAIN world.
// Read only the media metadata for mounted players; no API calls or credentials.
export function collectVideos(playerToken = null) {
  const isX = /(^|\.)(x\.com|twitter\.com)$/.test(location.hostname);
  if (!isX || location.protocol !== 'https:') return { videos: [], unsupported: true };

  const cleanURL = (raw, host, extension) => {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname === host && !url.username &&
        !url.password && !url.port && (!extension || url.pathname.endsWith(extension))
        ? url.href : null;
    } catch { return null; }
  };
  const normalize = (variants) => {
    const found = new Map();
    for (const variant of Array.isArray(variants) ? variants : []) {
      const url = cleanURL(variant?.src || variant?.url, 'video.twimg.com', '.mp4');
      if (!url) continue;
      // HLS fragments can also end in .mp4; only progressive video variants are accepted.
      if ((variant.type || variant.content_type || 'video/mp4') !== 'video/mp4') continue;
      if (/\/(?:pl|aud)\//.test(new URL(url).pathname)) continue;
      const dimensions = new URL(url).pathname.match(/\/(\d+)x(\d+)\//);
      const width = dimensions ? Number(dimensions[1]) : 0;
      const height = dimensions ? Number(dimensions[2]) : 0;
      found.set(url, { url, width, height, bitrate: Number(variant.bitrate) || 0 });
    }
    return [...found.values()].sort((a, b) => b.width * b.height - a.width * a.height || b.bitrate - a.bitrate);
  };
  const playerProps = (element) => {
    // X renders the MP4 variants in player props even when <video> plays a blob/HLS stream.
    // Bound traversal to the player subtree, avoiding any global store or account state.
    for (let elementDepth = 0; element && elementDepth < 4; elementDepth++, element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      let fiber = key && element[key];
      for (let depth = 0; fiber && depth < 32; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props && normalize(props.variants).length) return props;
        if (fiber.stateNode?.tagName === 'ARTICLE') break;
      }
    }
    return null;
  };

  let players = [...document.querySelectorAll('[data-testid="videoComponent"]')];
  if (playerToken !== null) {
    // Match exactly rather than interpolating page-controlled data into a selector.
    // Never fall back to another video when a targeted player has disappeared.
    players = players.filter(player => player.getAttribute('data-xvs-player') === playerToken);
  } else {
    for (const video of document.querySelectorAll('video')) {
      if (!players.some(player => player.contains(video))) players.push(video);
    }
  }
  const videos = new Map();
  for (const player of players) {
    const props = playerProps(player);
    const video = player.matches('video') ? player : player.querySelector('video');
    let variants = normalize(props?.variants);
    if (!variants.length && video) {
      variants = normalize([{ src: video.currentSrc || video.src },
        ...Array.from(video.querySelectorAll('source'), source => ({ src: source.src, type: source.type }))]);
    }
    if (!variants.length) continue;
    const isGif = props?.contentType === 'gif' || variants.some(variant => new URL(variant.url).pathname.startsWith('/tweet_video/'));
    // GIF MP4 URLs have no dimensions in their path. The decoded dimensions
    // are reliable only for the exact file currently loaded by this player.
    if (isGif && video?.videoWidth > 0 && video?.videoHeight > 0) {
      variants = variants.map(variant => !variant.width && variant.url === (video.currentSrc || video.src)
        ? { ...variant, width: video.videoWidth, height: video.videoHeight } : variant);
    }
    const article = player.closest('article');
    const links = [...(article?.querySelectorAll('a[href*="/status/"]') || [])];
    const propId = String(props?.videoId?.id || '');
    const postLink = links.find(link => propId && link.pathname.match(/\/status\/(\d+)/)?.[1] === propId)
      || links.find(link => link.querySelector('time')) || links[0];
    const postMatch = postLink?.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    const postId = /^\d+$/.test(propId) ? propId : postMatch?.[2] || '';
    const author = postMatch && postMatch[2] === postId && postMatch[1] !== 'i' ? postMatch[1] : '';
    const key = String(props?.contentId || variants[0].url.split('?')[0]);
    const bounds = player.getBoundingClientRect();
    const visible = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight;
    const previous = videos.get(key);
    if (previous) { previous.visible ||= visible; continue; }
    videos.set(key, {
      key, postId, author, variants, visible, mediaType: isGif ? 'gif' : 'video',
      index: Number(props?.videoId?.index) || 0,
      text: (article?.querySelector('[data-testid="tweetText"]')?.textContent || '').trim().slice(0, 280),
      poster: cleanURL(props?.poster || video?.poster, 'pbs.twimg.com'),
      duration: Math.max(0, Number(props?.durationMs) / 1000 || (Number.isFinite(video?.duration) ? video.duration : 0)),
      postUrl: postId ? `https://x.com/${author || 'i'}/status/${postId}` : '',
    });
  }
  const currentPostId = location.pathname.match(/\/status\/(\d+)/)?.[1];
  return { videos: [...videos.values()].sort((a, b) =>
    Number(b.postId === currentPostId) - Number(a.postId === currentPostId) || Number(b.visible) - Number(a.visible)),
    unsupported: false };
}
