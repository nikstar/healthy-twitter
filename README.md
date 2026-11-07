# Healthy Twitter

A small Chrome extension that makes X / Twitter calmer: Following by default, a daily time counter, deliberate playback, post shortcuts with Undo, and video/GIF downloads. It has no runtime dependencies.

See the [feature specification](SPEC.md) for the behavior to preserve and the [maintenance guide](docs/MAINTENANCE.md) for X integration points, repair recipes, and verification steps.

## Your time and settings

- **Following by default:** Home opens on Following. You can switch to For You; the extension chooses Following again the next time you enter Home.
- **Daily time counter:** a prominent card shows today’s time on Twitter. Only the selected Twitter tab in a focused Chrome window counts. Other tabs and unfocused windows do not add time; multiple Twitter tabs share one total. The counter resets at local midnight and survives browser restarts.
- **Settings popup:** click the green Twitter bird to configure every feature. Changes save automatically on this device and apply to open Twitter pages. Turning the counter off also stops time collection.

All features start enabled. The counter keeps only the current day’s total, with no URL history or cloud sync. It checkpoints about every five seconds, so a crash can lose the latest few seconds. Long suspension/sleep gaps are excluded.

## Post shortcuts

- **For You:** three compact buttons beside the author: Not interested, Show less from this account, and Block.
- **Following, replies, and other post views:** Block beside the author.
- Actions take effect immediately, with no confirmation dialog. A toast offers **Undo** for 15 seconds; its timer pauses while hovered or focused. Undo reverses recommendation feedback or unblocks the account.
- The account-specific feedback shortcut performs X's two native feedback steps, and Undo reverses both. Failed multi-step actions are rolled back; an incomplete rollback or failed Undo remains retryable.

Controls appear only when X provides the matching native action and inverse operation. Own posts are excluded. The extension uses the exact post's bound X actions and already-loaded feedback records, without reading credentials or constructing private API requests. X may change these internal bindings; unavailable actions are omitted rather than applied to another post.

## Deliberate playback

- Videos and GIFs start only when you press Play or click their playback surface.
- Every start, resume, and replay begins muted. You can unmute normally while watching; repeated player updates preserve that choice until playback is paused or finishes.
- Both HTML looping and X's JavaScript-based GIF/video restarts are blocked. Press Play again to replay.
- Paused or buffering frames and preview thumbnails are greyscale and dimmed. Actual playback restores their normal color; player controls retain their contrast.
- Manual pause, keyboard Play, and scrubbing remain available. Mute, download, and other controls do not grant permission for autoplay. Newly loaded timeline players are covered automatically.

These protections are on by default throughout X/Twitter. Audio-only elements are unaffected. Playback runs at document start so X cannot start a video before the guard is installed.

## Downloads

- **Player controls:** hover over a video and click the download arrow, just before volume (next to CC when captions are available).
- **Right-click menu:** right-click a video and choose **Download video**, alongside X's existing copy-link actions.

GIFs have a compact download button beside X's **GIF** badge and a **Download GIF** right-click item. X serves these animations as MP4s, so downloads preserve that original MP4 without conversion or quality loss.

The player and menu shortcuts save the highest available MP4 quality. Files use Chrome's configured Downloads folder; existing files are never overwritten.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project's `extension` folder.
4. Pin **Healthy Twitter** from Chrome's Extensions menu. If upgrading from X Video Saver, reload the same extension; its name changes without reinstalling.

Keep the extension folder in place; updates do not require reinstalling. Popup-only changes take effect when the popup is reopened. Manifest, background-worker, or content-script changes require **Reload** on the extension card in `chrome://extensions`. After content-script changes, refresh open X tabs too.

## How it works

The guard also synchronizes X's local player mute and loop settings with the media element. This prevents X from restoring an old unmuted preference and preserves its normal Replay controls after a clip finishes. This integration touches only the mounted player and makes no account-setting or network changes.

The playback guard runs in the page's main JavaScript world and gates video playback against recent, trusted interactions with that player. It disables native autoplay/loop flags, stops automatic restarts and end-of-clip rewinds, and keeps paused/playing styling in sync. It uses no extension APIs or network requests. The isolated content script adds controls to X's existing player and video menu. When you click Download, it sends only that player's identity to the extension worker, which reads the MP4 variants already attached to that specific player. The extension never reads authentication tokens, replays private API calls, or sends data to a downloader service. Only HTTPS MP4 files on `video.twimg.com` can be downloaded.

Permissions: host access is limited to HTTPS pages on `x.com`, `twitter.com`, and their subdomains, allowing player controls to appear automatically. `scripting` reads video metadata on the clicked tab, `downloads` saves files, and `storage` keeps settings and today’s time total locally. No browsing-history or broad tabs permission, analytics, remote code, or downloader service. The former `activeTab` permission is no longer needed.

X sometimes mounts a player only when it becomes visible or starts playing. If no MP4 is found, play the video, then try its download button again. The extension supports progressive MP4 variants, including X's video-based GIFs. Live broadcasts, DRM, and HLS-only media are not supported. X's internal player structure can change and require a collector update.

## Development

Use Chrome 111 or newer and Node.js 24 or newer for development. Run `npm ci` for test dependencies, then `npm test` and `npm run check`. Tests use jsdom to exercise autoplay and loop prevention, manual playback and seeking, player/source replacement, control insertion, context-menu targeting, keyboard navigation, and error handling. There is no build step; the `extension` directory is the complete distributable, and installing the extension does not require Node.js or npm.

GitHub Actions runs the tests and syntax checks on pushes and pull requests. Local screenshots, downloaded test media, environment files, and dependencies are excluded from Git. DOM fixtures are synthetic; the public example-post references in tests are not bundled media.

For browser playback checks, serve `test/browser/playback.html` alongside copies of `extension/playback.js`, `extension/playback.css`, and sample MP4 files named `video.mp4` and `gif.mp4`. The fixture deliberately attempts autoplay and JavaScript loops, and reports playback and styling state. Test media is not bundled in the extension.

For post-action checks, serve `test/browser/feed.html` at `/home/`, with `extension/feed.js` and `extension/feed.css` at the server root. Its sample accounts and native-action stand-ins stay local. It exercises trusted clicks, immediate hiding, the Undo toast, sequential feedback reversal, and failures without changing a real X account.

The green bird is adapted from [Bootstrap Icons’ Twitter icon](https://icons.getbootstrap.com/icons/twitter/), with its MIT notice included in `extension/icons/`. Run `npm run icons` to regenerate the PNGs from the packaged SVG.

Chrome references: [local storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [script execution](https://developer.chrome.com/docs/extensions/reference/api/scripting), and [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads).
