import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { collectVideos } from '../extension/collector.js';
import { isTwitterPage, validateVideoURL, videoFilename } from '../extension/shared.js';

const mp4 = (size, name = 'movie') => `https://video.twimg.com/amplify_video/123/vid/avc1/${size}/${name}.mp4?tag=29`;
const variant = (size, bitrate) => ({ src: mp4(size), type: 'video/mp4', bitrate });

function player({ id = '123', contentId = id, variants = [variant('720x1280', 2176000)], visible = true,
  contentType = 'video', videoSrc = 'blob:https://x.com/test', width = 0, height = 0 } = {}) {
  const link = { pathname: `/tester/status/${id}`, querySelector: () => ({}) };
  const article = { querySelectorAll: () => [link], querySelector: () => ({ textContent: 'A test video' }) };
  const video = { currentSrc: videoSrc, videoWidth: width, videoHeight: height, poster: 'https://pbs.twimg.com/test.jpg', duration: 10, querySelectorAll: () => [] };
  const element = {
    getAttribute: name => name === 'data-xvs-player' ? `player-${id}` : null,
    __reactFiber$test: { memoizedProps: {}, return: { memoizedProps: {
      variants, contentType, videoId: { id, index: 0 }, contentId, durationMs: 10287,
    }, return: null } },
    parentElement: null,
    contains: node => node === video,
    matches: () => false,
    querySelector: () => video,
    closest: () => article,
    getBoundingClientRect: () => ({ top: visible ? 100 : 1000, bottom: visible ? 300 : 1200, width: 300, height: 200 }),
  };
  return { element, video };
}

function scan(players, pathname = '/tester/status/123', token = null) {
  const context = { URL, location: { hostname: 'x.com', protocol: 'https:', pathname }, innerHeight: 800,
    document: { querySelectorAll: selector => players.map(p => selector === 'video' ? p.video : p.element) } };
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${collectVideos.toString()})(${JSON.stringify(token)})`, context)));
}

test('extracts MP4s from a blob player, removes HLS and duplicates, and sorts quality', () => {
  const result = scan([player({ variants: [variant('320x568', 632000),
    { src: 'https://video.twimg.com/amplify_video/123/pl/main.m3u8', type: 'application/x-mpegURL' },
    variant('720x1280', 2176000), variant('480x852', 950000), variant('720x1280', 2176000)] })]);
  assert.equal(result.videos.length, 1);
  assert.deepEqual(result.videos[0].variants.map(v => v.width), [720, 480, 320]);
  assert.equal(result.videos[0].postId, '123');
  assert.equal(result.videos[0].duration, 10.287);
});

test('keeps different posts separate, deduplicates players, and prioritizes the open post', () => {
  const result = scan([player({ id: '456' }), player({ id: '123', visible: false }), player({ id: '123' })]);
  assert.deepEqual(result.videos.map(v => v.postId), ['123', '456']);
  assert.equal(result.videos[0].visible, true);
});

test('does not cross the article boundary to pick up another post’s media', () => {
  const item = player();
  item.element.__reactFiber$test = { memoizedProps: {}, stateNode: { tagName: 'ARTICLE' },
    return: { memoizedProps: { variants: [variant('720x1280', 1)] } } };
  assert.deepEqual(scan([item]).videos, []);
});

test('supports legacy url/content_type variants and plain progressive video elements', () => {
  const legacy = player({ variants: [{ url: mp4('480x852'), content_type: 'video/mp4' }] });
  assert.equal(scan([legacy]).videos[0].variants[0].width, 480);
  delete legacy.element.__reactFiber$test;
  legacy.video.currentSrc = mp4('320x568');
  assert.equal(scan([legacy]).videos[0].variants[0].width, 320);
});

test('preserves GIF MP4s and gets their dimensions from the exact decoded source', () => {
  const source = 'https://video.twimg.com/tweet_video/HWc2YIWWUAAADXE.mp4';
  const gif = player({ contentType: 'gif', videoSrc: source, width: 480, height: 360,
    variants: [{ src: source, type: 'video/mp4', bitrate: 0 }] });
  const result = scan([gif]);
  assert.equal(result.videos[0].mediaType, 'gif');
  assert.deepEqual(result.videos[0].variants[0], { url: source, width: 480, height: 360, bitrate: 0 });
  delete gif.element.__reactFiber$test;
  assert.equal(scan([gif]).videos[0].mediaType, 'gif', 'direct GIF sources work without React metadata');
  gif.video.currentSrc = 'https://video.twimg.com/tweet_video/OTHER.mp4';
  const mismatched = player({ contentType: 'gif', videoSrc: gif.video.currentSrc, width: 480, height: 360,
    variants: [{ src: source, type: 'video/mp4', bitrate: 0 }] });
  assert.equal(scan([mismatched]).videos[0].variants[0].width, 0, 'dimensions from another source are never reused');
});

test('rejects arbitrary hosts, deceptive suffixes, credentials, non-HTTPS, HLS and fragments', () => {
  for (const url of ['https://evil.test/video.mp4', 'https://video.twimg.com.evil.test/video.mp4',
    'https://video.twimg.com@evil.test/video.mp4', 'http://video.twimg.com/video.mp4',
    'https://user:pass@video.twimg.com/video.mp4', 'https://video.twimg.com:444/video.mp4',
    'https://video.twimg.com/pl/segment.mp4', 'https://video.twimg.com/aud/audio.mp4',
    'https://video.twimg.com/video.m3u8', 'file:///tmp/video.mp4', 'blob:https://x.com/video']) {
    assert.equal(validateVideoURL(url), null, url);
    assert.deepEqual(scan([player({ variants: [{ src: url }] })]).videos, [], url);
  }
  assert.equal(validateVideoURL(mp4('720x1280')), mp4('720x1280'));
});

test('permits only X/Twitter pages and produces safe, descriptive filenames', () => {
  assert.equal(isTwitterPage('https://x.com/test/status/123'), true);
  assert.equal(isTwitterPage('https://mobile.twitter.com/test'), true);
  assert.equal(isTwitterPage('https://x.com.evil.test'), false);
  assert.equal(isTwitterPage('chrome://extensions'), false);
  assert.equal(videoFilename({ author: 'TTrending48', postId: '2118711616732598471', index: 0, width: 720, height: 1280 }),
    'TTrending48_2118711616732598471_1_720x1280.mp4');
  assert.equal(videoFilename({ author: '../../bad', postId: '/../../123', index: -4 }), 'bad_123_1.mp4');
});

test('targeted extraction selects the clicked player and never falls back to another post', () => {
  const players = [player({ id: '123' }), player({ id: '456' })];
  assert.deepEqual(scan(players, '/tester/status/123', 'player-456').videos.map(v => v.postId), ['456']);
  assert.deepEqual(scan(players, '/tester/status/123', 'removed-player').videos, []);
  assert.deepEqual(scan(players, '/tester/status/123', '\"] article').videos, []);
});

test('worker validates sender, resolves the clicked player, and never overwrites existing files', async () => {
  let listener;
  const calls = [];
  const scripts = [];
  const chrome = {
    runtime: { id: 'test-extension', getURL: name => `chrome-extension://test-extension/${name}`,
      onMessage: { addListener: callback => { listener = callback; } } },
    downloads: { download: async options => { calls.push(options); return 7; } },
    scripting: { executeScript: async options => { scripts.push(options); return [{ result: {
      videos: options.args[0] === 'missing' ? [] : [{ author: 'clicked', postId: '456', variants: [{ url: mp4('720x1280'), width: 720, height: 1280 }] }],
    } }]; } },
  };
  const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, { chrome, validateVideoURL, videoFilename, isTwitterPage, collectVideos, installActivity: () => ({}) });
  const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  assert.equal(listener({ type: 'download', url: mp4('720x1280') }, { ...sender, url: 'https://x.com' }, () => {}), undefined);
  assert.equal(listener({ type: 'download', url: mp4('720x1280') }, sender, () => {}), undefined, 'the settings popup no longer accepts download URLs');
  const contentSender = { id: chrome.runtime.id, tab: { id: 42 }, frameId: 0, url: 'https://x.com/test/status/456' };
  assert.equal(listener({ type: 'download', url: mp4('720x1280') }, contentSender, () => {}), undefined);
  assert.equal(listener({ type: 'download-player', playerToken: 'test' }, { ...contentSender, frameId: 1 }, () => {}), undefined);
  assert.equal(listener({ type: 'download-player', playerToken: 'test' }, { ...contentSender, url: 'https://evil.test' }, () => {}), undefined);
  const inline = await new Promise(resolve => listener({ type: 'download-player', playerToken: 'player-456' }, contentSender, resolve));
  assert.equal(inline.id, 7);
  assert.equal(calls[0].conflictAction, 'uniquify');
  assert.equal(calls[0].saveAs, false);
  assert.equal(scripts[0].target.tabId, 42);
  assert.deepEqual(Array.from(scripts[0].args), ['player-456']);
  assert.equal(calls[0].filename, 'clicked_456_1_720x1280.mp4');
  const missing = await new Promise(resolve => listener({ type: 'download-player', playerToken: 'missing' }, contentSender, resolve));
  assert.match(missing.error, /No MP4/);
  assert.equal(calls.length, 1);
});

test('manifest limits automatic integration to X/Twitter and packaged scripts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['scripting', 'downloads', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://*.x.com/*', 'https://*.twitter.com/*']);
  for (const script of manifest.content_scripts) {
    assert.deepEqual(script.matches, manifest.host_permissions);
    assert.equal(script.all_frames, undefined);
  }
  const guard = manifest.content_scripts.find(script => script.js.includes('playback.js'));
  assert.equal(guard.run_at, 'document_start');
  assert.equal(guard.world, 'MAIN');
  const feed = manifest.content_scripts.find(script => script.js.includes('feed.js'));
  assert.equal(feed.world, 'MAIN');
  assert.equal(feed.run_at, 'document_idle');
  for (const filename of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css])]) {
    assert.ok((await readFile(new URL(`../extension/${filename}`, import.meta.url))).length);
  }
});
