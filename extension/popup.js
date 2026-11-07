import { collectVideos } from './collector.js';
import { isTwitterPage, validateVideoURL } from './shared.js';

const status = document.querySelector('#status');
const container = document.querySelector('#videos');
const refresh = document.querySelector('#refresh');
const downloads = new Map();
let scanVersion = 0;

function showDownloadStatus(element, text, error = false) {
  element.hidden = false;
  element.textContent = text;
  element.classList.toggle('error', error);
}

function renderVideo(video, position) {
  const card = document.querySelector('#video-template').content.firstElementChild.cloneNode(true);
  const image = card.querySelector('.poster');
  if (video.poster) image.src = video.poster; else card.querySelector('.preview').hidden = true;
  image.addEventListener('error', () => { card.querySelector('.preview').hidden = true; });
  card.querySelector('.duration').textContent = video.duration ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : 'VIDEO';
  card.querySelector('.author').textContent = video.author ? `@${video.author}` : `Video ${position + 1}`;
  card.querySelector('.format').textContent = video.mediaType === 'gif' ? 'GIF · MP4' : 'MP4';
  card.querySelector('.caption').textContent = video.text || 'Video from X';
  const select = card.querySelector('select');
  select.setAttribute('aria-label', `Quality for video ${position + 1}`);
  for (const [index, variant] of video.variants.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${variant.width && variant.height ? `${variant.width} × ${variant.height}` : 'Original'}${index === 0 ? ' · Best' : ''}`;
    select.append(option);
  }
  const button = card.querySelector('.download');
  const feedback = card.querySelector('.download-status');
  button.addEventListener('click', async () => {
    const variant = video.variants[Number(select.value)];
    if (!variant || !validateVideoURL(variant.url)) return;
    button.disabled = true;
    showDownloadStatus(feedback, 'Starting download…');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'download', ...video, ...variant });
      if (response?.error || !Number.isInteger(response?.id)) throw new Error(response?.error || 'Download could not start.');
      downloads.set(response.id, { feedback, button });
      showDownloadStatus(feedback, 'Downloading… You can close this popup.');
      // A small cached MP4 can complete before the message reply arrives.
      const [item] = await chrome.downloads.search({ id: response.id });
      if (item) updateDownload(item.id, item.state, item.error);
    } catch (error) {
      showDownloadStatus(feedback, error.message || 'Download failed. Please try again.', true);
      button.disabled = false;
    }
  });
  container.append(card);
}

function updateDownload(id, state, error) {
  const entry = downloads.get(id);
  if (!entry) return;
  if (state === 'complete') {
    showDownloadStatus(entry.feedback, 'Saved to your Downloads folder.');
    entry.button.disabled = false;
    downloads.delete(id);
  } else if (state === 'interrupted') {
    showDownloadStatus(entry.feedback, `Download interrupted${error ? ` (${error})` : ''}. Try again.`, true);
    entry.button.disabled = false;
    downloads.delete(id);
  }
}
chrome.downloads.onChanged.addListener(delta => updateDownload(delta.id, delta.state?.current, delta.error?.current));

async function scan() {
  const version = ++scanVersion;
  refresh.disabled = true;
  status.textContent = 'Looking for videos…';
  container.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isTwitterPage(tab.url)) {
      status.textContent = 'Open a video post on x.com or twitter.com, then click this extension.';
      return;
    }
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectVideos });
    if (version !== scanVersion) return;
    const videos = results[0]?.result?.videos || [];
    status.textContent = videos.length ? `${videos.length} video${videos.length === 1 ? '' : 's'} found · Highest quality selected` :
      'No downloadable videos found yet. Play the video on X, then click Refresh. Live streams and protected media are not supported.';
    videos.forEach(renderVideo);
  } catch {
    status.textContent = 'Could not read this page. Reload the X tab, then reopen the extension.';
  } finally {
    if (version === scanVersion) refresh.disabled = false;
  }
}
refresh.addEventListener('click', scan);
scan();
