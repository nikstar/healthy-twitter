# Healthy Twitter feature specification

Baseline: version **1.4.0**, documented **2026-11-07**.

This document describes the behavior to preserve when X changes. DOM selectors, React structures, and native action signatures are replaceable implementation details; their current forms are documented in [the maintenance guide](docs/MAINTENANCE.md). A passing fixture test alone does not establish compatibility with the current website.

## 1. Purpose and scope

Healthy Twitter makes media playback deliberate, makes feed curation accessible beside a post's author, and saves original video files without an external downloader service.

- Chrome Manifest V3 extension, currently declaring Chrome 111 or later.
- Automatic integration is limited to HTTPS `x.com`, `twitter.com`, and their subdomains, in the top frame.
- All protections are enabled by default. There is no settings page, per-feature toggle, cloud service, telemetry, or extension-owned persistent preference store.
- Existing X controls, navigation, keyboard interaction, captions, volume, seeking, picture-in-picture, and fullscreen should remain usable.
- The installable artifact is the `extension/` directory. No build step or runtime dependency installation is required.

## 2. Deliberate playback

### PLY-01 — No autoplay

Videos, including animations X labels as GIFs, start paused. Loading a post, scrolling a player into view, returning to it, or X retrying `play()` must not grant playback permission.

A deliberate Play/Replay action or click on the playback surface authorizes only that player. Keyboard playback is supported when directed at that player. The large Play overlay and compact control-bar Play button must both work; after completion, Watch again and Replay must work too.

Mute, captions, settings, downloads, links, and actions on another post must not authorize playback. Synthetic page-generated clicks must not authorize it. Audio-only elements are outside the video guard and remain unchanged.

The guard starts before X's player code. It covers videos inserted later, lazy-created players, and elements reused for a different media source. A pending explicit Play action must survive initial source/metadata loading. A new source must not inherit an old playback session.

### PLY-02 — One playback per deliberate start

Neither native HTML looping nor X's JavaScript restart/rewind mechanism may loop a video or GIF automatically. At completion the media stays stopped and greyed out. The native player should offer usable replay controls.

Manual replay and manual backward seeking must remain possible. A manual Pause must remain Pause; the guard must not change `paused` early in a click handler and accidentally reverse X's toggle.

### PLY-03 — Start muted

Each new start, resume, and replay begins muted, including after another video was unmuted. X's sound button must agree with the actual media state.

The user can unmute normally while watching. Repeated `play()` calls or player rerenders during the same playback session must preserve that choice. Pausing or finishing ends that session; the next start is muted again.

Setting `video.muted = true` once is insufficient: X may reapply its previous sound state during rendering. Native player state and the media element must stay synchronized.

### PLY-04 — Grey inactive media

Paused video frames, unloaded preview thumbnails, buffering media, and completed clips appear greyscale and dimmed. Actual playback restores normal color. Player buttons and other controls keep their normal contrast.

The baseline filter is `grayscale(1) brightness(.65)`. This is applied to media and poster images/backgrounds, not the entire player container. Playback color is restored on actual `playing`, not merely a pending `play()` request.

## 3. Post shortcuts

### FEED-01 — Placement and availability

| Surface | Author-row actions |
| --- | --- |
| For You home timeline | Not interested; Show less from this account; Block |
| Following | Block |
| Post details, replies, profiles, and other supported post views | Block |
| Own posts | None |

Use compact, always-visible icon buttons beside the author, grouped with X's existing Grok/More controls. Each button has a descriptive accessible name and tooltip. Preserve native text truncation and keep the row usable for long names.

Only expose an action when the exact post has the necessary native action and inverse operation. If X no longer exposes them, omit the affected shortcut rather than applying an approximate action to another account. Already-blocked accounts do not get another Block button.

For You scope is checked both when rendering and when activating a recommendation-feedback button. Switching tabs or navigating within X updates the buttons without requiring a page reload.

### FEED-02 — Not interested

One click submits X's native Not interested feedback for that timeline entry and immediately hides its displayed cell. It is real recommendation feedback, not just a local cosmetic dismissal.

Undo reverses that feedback and restores the entry when X still has it available. The bound inverse must remain usable even if X replaces the original article with a feedback placeholder.

### FEED-03 — Show less from this account

One click performs the same two steps as X's native flow:

1. Not interested in this post.
2. Show fewer posts from its author.

This changes recommendation feedback; it does not mute or block the account. The selected post is hidden immediately. Other posts from that account are not hard-filtered by this action.

Undo reverses the account-specific step, then the original Not interested step. If applying the second step fails, roll back the attempted steps. If rollback or Undo fails partway through, preserve the remaining inverse operations so a retry does not repeat steps already undone.

### FEED-04 — Block

One click invokes X's native block action for the author, without a confirmation dialog. Matching mounted posts from that account disappear immediately; unrelated posts remain visible. The block is an X account action and persists according to X's normal behavior.

Undo invokes X's native unblock action for that same user ID and restores locally hidden posts. Undo means **unblock**; it does not promise to recreate following relationships or other collateral changes made by X's blocking behavior.

### FEED-05 — Undo and error states

- Show an Undo toast immediately, including while the initial action is pending.
- After success, offer Undo for 15 seconds. Pause the timer while hovered or while focus is inside the toast. Do not expire a pending action or Undo operation.
- If Undo is clicked before the initial request finishes, wait for that request, then reverse it exactly once.
- Multiple actions retain independent toasts and inverse operations.
- Keyboard activation moves focus to Undo. Enter/Space must not propagate into X's post-navigation shortcuts.
- Failed actions show an error and restore local visibility when rollback succeeds. Failed Undo or incomplete feedback rollback remains retryable, with a longer 30-second window in the baseline implementation.
- Successful Undo replaces the button with a short confirmation. Closing or expiring the toast does not automatically undo the action.
- Toasts and pending inverse state are in-memory for the current page; they do not survive a full page reload.

### FEED-06 — Correct targeting

Every activation revalidates the article's post ID and author against the current DOM and native props. A recycled or detached element must not act on a different post. The target user ID comes from the matched post, not a quoted post, unrelated menu, global selection, or a stale author label.

Ignore synthetic clicks. Suppress duplicate actions on the same pending/hidden post and duplicate block operations for the same account. A block or feedback failure must not be reported as success.

## 4. Video and GIF downloads

### DL-01 — Supported media and quality

Save progressive MP4 variants that are already available to the mounted X player. Blob/HLS playback may still have downloadable MP4 variants in the player's metadata.

GIFs are saved as X's original MP4, without conversion to `.gif`, transcoding, or quality loss. The popup labels them **GIF · MP4**; inline actions say **Download GIF**.

Deduplicate variant URLs, then rank by pixel area and bitrate. Inline and context-menu actions choose the highest-ranked variant. The popup lets the user choose a quality and defaults to the best one. When dimensions cannot be determined, present the original variant without inventing a resolution.

Unsupported: live broadcasts without a progressive MP4, HLS-only media, DRM/protected media, arbitrary external media hosts, and video conversion. No access-control bypass is part of this extension.

### DL-02 — Player buttons

- Regular videos: put the download arrow in the native controls immediately before volume, after CC when CC exists.
- GIFs: put a compact download arrow beside the GIF badge. A temporary lower-right fallback is allowed before native GIF controls mount; move it into the controls when available.
- Buttons are keyboard-focusable, have useful accessible names/tooltips, and do not toggle playback.
- Avoid duplicate controls after rerenders or remounts. Restore a control removed by X's rendering.
- While preparing a download, prevent duplicate requests for that player and expose a busy state. Clear it after success or failure.

### DL-03 — Native right-click menus

Append Download video to X's video menu containing its native copy-video actions. Append Download GIF to the GIF menu containing Copy GIF Address. Preserve X's existing items, typography, and spacing.

Target the player that was actually right-clicked. If a menu is reused for another player, update its target. Never extend an unrelated post/account/page menu or choose a different player if the original disappears.

Arrow keys, Home, and End must include the new item; Enter/Space activates it. Dismiss X's menu through its own event handling before starting the download. The baseline X menu dismisses on Escape **keyup**, so keydown alone is not sufficient.

### DL-04 — Toolbar popup

The popup is named Healthy Twitter and summarizes the enabled protections. It scans the active X/Twitter tab and lists mounted downloadable media, prioritizing the open post, then visible players.

Each card shows available author/caption, poster, duration, format, a quality selector, and Download. Missing or failed poster images must not break the card. Refresh scans again, and stale asynchronous results must not replace a newer scan.

On other sites, prompt the user to open X/Twitter. When no variants are available, explain that the player may need to mount/start and offer Refresh. Handle page-access errors and invalidated extension contexts with actionable reload guidance.

### DL-05 — Saving and status

Use Chrome Downloads with `saveAs: false` and `conflictAction: 'uniquify'`. Respect Chrome's configured destination and never overwrite an existing file.

Filename pattern:

```text
<author>_<post-id>_<one-based-media-index>_<width>x<height>.mp4
```

Sanitize all fields. Omit unknown dimensions; use safe fallback author/post identifiers when metadata is missing. Inline notifications report that a download started. The popup also follows completion/interruption while open, including files that finish before its first status query. Downloads continue after the popup closes.

## 5. Security and privacy boundaries

| Permission/access | Purpose |
| --- | --- |
| X/Twitter HTTPS host access | Install page controls and the playback guard |
| `scripting` | Inspect the selected page's mounted media metadata in the main world |
| `activeTab` | Support the toolbar workflow |
| `downloads` | Start downloads and display their status |

No browsing-history permission, credential extraction, remote extension code, analytics endpoint, external downloader, or extension-owned account API client is required.

Feed actions intentionally change the user's X account/recommendations when the user clicks a shortcut. They use X's already-bound functions and loaded feedback records; the extension does not read cookies/bearer tokens or reconstruct authenticated HTTP requests. Playback synchronization only changes the local player.

Download URLs must be HTTPS on exactly `video.twimg.com`, with an `.mp4` pathname, no embedded credentials or non-default port, and no known `/pl/` or `/aud/` fragment path. Preserve valid CDN query parameters. Poster URLs are limited to HTTPS `pbs.twimg.com`.

The download worker validates the extension sender. It accepts direct URL requests only from its own popup. An X content script sends only a bounded player token; the worker resolves that exact player in the sender's top frame and validates the resulting URL again. A missing target is an error, never a reason to download another post's video.

## 6. Architecture and lifecycle

| Component | Role |
| --- | --- |
| `playback.js`, `playback.css` | Main world at document start; native media guard, local X player synchronization, inactive styling |
| `feed.js`, `feed.css` | Main world at document idle; author-row controls, native feed actions, Undo, local visibility |
| `content.js`, `content.css` | Isolated world at document idle; download buttons, native context menus, notifications |
| `collector.js` | Self-contained function serialized into the main world to inspect mounted media |
| `background.js`, `shared.js` | Sender/URL validation, exact-player extraction, safe filenames, Chrome Downloads |
| `popup.*` | Toolbar media list, quality selection, refresh, download status |

Use event listeners and batched mutation observation rather than continuous polling. Cover initial page load, SPA navigation, inserted players/posts, source replacement, and React remounts. Ignore owned insertions and ordinary timer text where possible so playback does not cause perpetual rescanning.

Use narrowly scoped identities and traversal limits. Keep media collection bounded to a player/post and feed actions bounded to the matching article/entry. Do not hard-code minified React component names or user-specific feedback keys.

## 7. Acceptance and evidence

| Area | Automated coverage | Live acceptance checks |
| --- | --- | --- |
| Playback | `test/playback.test.js` | Paused load/scroll; muted start; unmute; pause/resume; end/replay; GIF; seeking; actual grey/color state |
| Feed | `test/feed.test.js` | Three For You buttons; Block elsewhere; matching author; layout and tooltips; approved account/feedback action and Undo |
| Download UI | `test/content.test.js` | Player/CC placement; GIF badge; right-click target; menu dismissal; keyboard access |
| Collector/worker | `test/extension.test.js` | Blob-backed player extraction; real MP4 save; correct media/filename; popup quality/status |
| Local browser fixtures | `test/browser/playback.html`, `test/browser/feed.html` | Trusted input, actual media events, visible toasts, tab switching, simulated errors |

Baseline automated suite: **45 tests**. Run `npm ci`, `npm test`, and `npm run check`. CI runs the same commands on Node 24.

On 2026-11-07, real X pages were used to inspect and visually verify player controls, downloader paths, autoplay/loop prevention, muted playback, and post-shortcut placement/scope. Feed mutation/Undo sequences were exercised with synthetic native bindings in unit tests and a local Chrome fixture; real accounts were not arbitrarily blocked or given recommendation feedback for testing. Distinguish fixture validation, temporary page previews, and validation of the installed/reloaded extension in future reports.

## 8. Non-goals and constraints

- No automatic liking, posting, following, feed curation, or account blocking without a deliberate shortcut click.
- No guarantee that a native X account change reverses every related platform side effect.
- No persistent Undo history, synced preferences, or automatic extension reload mechanism.
- No promises of compatibility with every locale, experiment, or future X layout. The repair process must preserve the behaviors above while replacing obsolete bindings.
- Screenshots, user downloads, account state, and temporary debugging captures are local QA artifacts, not repository content.
