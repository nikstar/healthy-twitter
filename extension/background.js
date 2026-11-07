import { isTwitterPage, validateVideoURL, videoFilename } from './shared.js';
import { collectVideos } from './collector.js';

async function startDownload(video) {
  const url = validateVideoURL(video.url);
  if (!url) throw new Error('This is not a supported X video URL.');
  const id = await chrome.downloads.download({
    url, filename: videoFilename(video), conflictAction: 'uniquify', saveAs: false,
  });
  return { id, width: video.width, height: video.height };
}

async function downloadPlayer(message, sender) {
  if (typeof message.playerToken !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.playerToken)) {
    throw new Error('This video is no longer available. Please try again.');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN',
    func: collectVideos, args: [message.playerToken],
  });
  const video = results[0]?.result?.videos?.[0];
  const best = video?.variants?.[0];
  if (!best) throw new Error('No MP4 found. Play the video, then try again. Live streams and protected media are not supported.');
  return startDownload({ ...video, ...best });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  const fromContent = Number.isInteger(sender.tab?.id) && sender.frameId === 0 && isTwitterPage(sender.url);
  let operation;
  if (fromPopup && message?.type === 'download') operation = startDownload(message);
  // Content scripts send only a player identity, not an arbitrary download URL.
  // The worker resolves that specific player from the sender's tab each time.
  else if (fromContent && message?.type === 'download-player') operation = downloadPlayer(message, sender);
  else return;
  operation.then(sendResponse, error => sendResponse({ error: error.message || 'Chrome could not start the download. Please try again.' }));
  return true;
});
