# Healthy Twitter feature specification

Baseline: version **1.6.0**, documented **2026-11-07**.

This document describes the behavior to preserve when X changes. DOM selectors, React structures, and native action signatures are replaceable implementation details; their current forms are documented in [the maintenance guide](docs/MAINTENANCE.md). A passing fixture test alone does not establish compatibility with the current website.

## 1. Purpose and scope

Healthy Twitter makes media playback deliberate, makes feed curation accessible beside a post's author, and saves original video files without an external downloader service.

- Chrome Manifest V3 extension, currently declaring Chrome 111 or later.
- Automatic integration is limited to HTTPS `x.com`, `twitter.com`, and their subdomains, in the top frame.
- All features are enabled by default and individually configurable in the toolbar settings popup. Preferences and the current daily time total are stored locally; there is no cloud service or telemetry. Playback and shortcut requirements below describe their enabled behavior.
- Existing X controls, navigation, keyboard interaction, captions, volume, seeking, picture-in-picture, and fullscreen should remain usable.
- The installable artifact is the `extension/` directory. No build step or runtime dependency installation is required.

## 2. Deliberate playback

### PLY-01 — No autoplay

Videos, including animations X labels as GIFs, start paused. Loading a post, scrolling a player into view, returning to it, or X retrying `play()` must not grant playback permission.

A deliberate Play/Replay action or click on the playback surface authorizes only that player. Keyboard playback is supported when directed at that player. The large Play overlay and compact control-bar Play button must both work; after completion, Watch again and Replay must work too.

Mute, captions, settings, downloads, links, and actions on another post must not authorize playback. Synthetic page-generated clicks must not authorize it. Audio-only elements are outside the video playback/loop guard; AUDIO-01 separately prevents their background audio starts.

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

### AUDIO-01 — Prevent background audio/device activation

Enable `preventBackgroundAudio` by default. Install its main-world guard before the video playback guard, at document start. A new media element must be muted before X assigns a source or calls `load()`. Preserve the page’s requested values, but hold preload at `none` and defer background `load()` calls until playback is permitted. Cover DOM-created, parser-created, cloned, detached, and `new Audio(...)` elements, source properties/attributes, and source replacement. This is an output-avoidance measure, not a claim that the browser can never fetch metadata.

Reject background audio-only `play()` attempts. Normal Play on a video still obeys PLY-01 and starts muted by default. A trusted action on that player’s native volume/unmute control or its M keyboard shortcut grants sound permission only for that element. Synthetic clicks, unrelated clicks, downloads, and progress seeking must not grant sound permission. Native browser media controls need equivalent handling because their actions can bypass JS property setters.

Preserve intentional sound during a playing session. Revoke it and mute on pause, end, or source replacement. A pending explicit initial Play must survive the source’s initial `emptied`/load lifecycle. When Start muted is disabled, an explicit Play may honor X’s requested audible state; automatic retries must not grant sound.

Construct Web Audio contexts with `sinkId: { type: 'none' }` from the start, preserving caller options and supplying a 48 kHz sample rate only when omitted. Do not construct a hardware-output context and suspend it afterward. Background `setSinkId()` requests must retain the no-output sink. An audio graph connected to an explicitly authorized, unmuted, playing media element may use its requested output; muting/pausing returns it to no output. Do not change OfflineAudioContext or request microphone/device permissions. If the browser lacks no-output-sink support, fail before allocating a realtime context while protection is enabled.

Turning the setting off restores recorded media/output requests, including detached elements, and releases deferred loads. Keep this switch available for Spaces, calls, or other site audio flows not tied to a recognized media sound control. No macOS/Bluetooth configuration is changed. Guards cover the extension’s injected X page world; browser internals, other extensions, foreign frames, and OS routing are not fully controllable from this extension. Actual AirPods switching requires a device-level acceptance check and must not be reported as fixed solely from JavaScript state or fixture tests.

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

GIFs are saved as X's original MP4, without conversion to `.gif`, transcoding, or quality loss. Inline actions say **Download GIF**.

Deduplicate variant URLs, then rank by pixel area and bitrate. Inline and context-menu actions choose the highest-ranked variant. There is no separate quality picker in the settings popup. When dimensions cannot be determined, present the original variant without inventing a resolution.

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

### DL-04 — Former toolbar download UI (retired in 1.5.0)

Version 1.4.0 had a mounted-media list, quality picker, refresh, preview metadata, and download status in the popup. At the user’s request, 1.5.0 replaces that surface with settings (SET-01). The player and right-click download actions remain. Do not restore the old popup during a website compatibility repair. The original implementation and specification remain in Git history.

### DL-05 — Saving and status

Use Chrome Downloads with `saveAs: false` and `conflictAction: 'uniquify'`. Respect Chrome's configured destination and never overwrite an existing file.

Filename pattern:

```text
<author>_<post-id>_<one-based-media-index>_<width>x<height>.mp4
```

Sanitize all fields. Omit unknown dimensions; use safe fallback author/post identifiers when metadata is missing. Inline notifications report that a download started. Chrome’s own Downloads UI reports completion or interruption. Downloads continue independently of the settings popup.

## 5. Home, time awareness, and settings

### HOME-01 — Following by default

On initial load of `/home` and whenever navigation enters Home from another route, select Following once its native tabs are available. Leave other routes alone. Wait for lazy-mounted tabs, and do not repeatedly switch tabs during rerenders. A deliberate choice of For You on that visit must remain selected. Enabling this preference while already on Home also selects Following once.

This uses X’s native Home tab control, without changing account preferences or following relationships. The current integration assumes For You is first and Following second; update this binding if X changes the tab structure.

### TIME-01 — Daily active Twitter time

Show a prominent `TODAY ON TWITTER` card with `H:MM:SS` on Twitter pages. Prefer the right sidebar; use a compact floating card on layouts without it. Preserve a readable counter while the user browses. The timer is not an announcing live region: screen readers must not be interrupted every second.

Count only when an X/Twitter tab is selected in the focused, non-minimized Chrome window. No accumulation for background tabs or unfocused Chrome windows. Multiple Twitter tabs/windows share one daily total and never multiply time. This measures active-tab time, not keyboard/mouse activity; reading without interaction still counts.

Use the device’s local calendar day. Split a normal active interval at midnight; the new day starts from zero. Keep only the current day and its accumulated milliseconds, not visited URLs, post IDs, or a historical log. Persist the total across reloads and browser restarts. Never count browser downtime or long device-suspension gaps.

The worker checkpoints on roughly five-second content heartbeats and browser activation/focus events. A crash may lose the last uncommitted few seconds. A gap longer than 15 seconds is treated as suspension and excluded instead of guessing how much was active. The visible seconds interpolate between successful checkpoints. Turning the preference off removes the card and stops collection while preserving today’s accumulated total.

### SET-01 — Settings popup and identity

The toolbar icon is the classic Twitter bird recolored green. Use the same mark in the settings popup; provide PNGs at 16, 32, 48, and 128 pixels. Keep the SVG source and its attribution/license notice in the package.

Clicking the icon opens a settings page in the popup, with today’s saved time and these independent switches, all defaulting on:

| Group | Preference keys | Behavior |
| --- | --- | --- |
| Your time | `defaultFollowing`, `showTimer` | Home default; visible daily counter and collection |
| Playback | `preventBackgroundAudio`, `preventAutoplay`, `preventLoop`, `startMuted`, `greyPaused` | Early audio protection; deliberate start; no loops; muted starts; inactive styling |
| Post shortcuts | `showNotInterested`, `showLessAccount`, `showBlock` | Each author-row action independently |
| Downloads | `playerDownload`, `menuDownload` | Player button and native right-click item independently |

Save changes automatically and locally. Apply them to open X tabs without another extension reload. Unknown/malformed stored values fall back to defaults. Show load/save errors instead of claiming success; a failed save restores the switch. Disabling a feed shortcut does not reverse earlier account actions or remove pending Undo controls.

When autoplay or loop prevention is disabled, restore recorded native flags and allow X to control that behavior. Turning off start-muted does not force the current video to unmute; subsequent playback uses X’s normal sound behavior. These settings are independent: disabling autoplay prevention must not disable loop prevention. When loop prevention is off, an already-authorized session may loop.

On a fresh page, the document-start guard uses safe defaults until saved preferences arrive. Only boolean preferences cross into the page’s main world; page events cannot persist settings or invoke extension APIs.

## 6. Security and privacy boundaries

| Permission/access | Purpose |
| --- | --- |
| X/Twitter HTTPS host access | Install page controls and the playback guard |
| `scripting` | Inspect the selected page's mounted media metadata in the main world |
| `storage` | Local settings and the current daily usage total |
| `downloads` | Start downloads and display their status |

No browsing-history permission, credential extraction, remote extension code, analytics endpoint, external downloader, or extension-owned account API client is required.

Feed actions intentionally change the user's X account/recommendations when the user clicks a shortcut. They use X's already-bound functions and loaded feedback records; the extension does not read cookies/bearer tokens or reconstruct authenticated HTTP requests. Playback synchronization only changes the local player.

Download URLs must be HTTPS on exactly `video.twimg.com`, with an `.mp4` pathname, no embedded credentials or non-default port, and no known `/pl/` or `/aud/` fragment path. Preserve valid CDN query parameters. Poster URLs are limited to HTTPS `pbs.twimg.com`.

The download worker validates the extension sender. The settings popup cannot submit download URLs. An X content script sends only a bounded player token; the worker resolves that exact player in the sender's top frame and validates the resulting URL again. A missing target is an error, never a reason to download another post's video.

## 7. Architecture and lifecycle

| Component | Role |
| --- | --- |
| `audio.js` | Main world at document start, before playback; early mute/preload/load guard and no-output Web Audio |
| `playback.js`, `playback.css` | Main world at document start; native media guard, local X player synchronization, inactive styling |
| `feed.js`, `feed.css` | Main world at document idle; author-row controls, native feed actions, Undo, local visibility |
| `content.js`, `content.css` | Isolated world at document idle; download buttons, native context menus, notifications |
| `collector.js` | Self-contained function serialized into the main world to inspect mounted media |
| `background.js`, `shared.js` | Sender/URL validation, exact-player extraction, safe filenames, Chrome Downloads |
| `popup.*` | Settings switches, persistence/errors, today’s saved total |
| `settings.js`, `settings-bridge.js` | Shared boolean schema and main/isolated-world preference delivery |
| `preferences.js`, `preferences.css` | Following selection, local settings bridge, visible timer and heartbeat |
| `activity.js` | Serialized service-worker time ledger, browser focus/tab checks, day rollover |

Use event listeners and batched mutation observation for player/post controls. The time counter has a one-second display tick and five-second heartbeat; the display tick also catches SPA route changes that lack DOM mutations. Cover initial page load, SPA navigation, inserted players/posts, source replacement, and React remounts. Ignore owned insertions and ordinary timer text where possible so playback does not cause perpetual rescanning.

Use narrowly scoped identities and traversal limits. Keep media collection bounded to a player/post and feed actions bounded to the matching article/entry. Do not hard-code minified React component names or user-specific feedback keys.

## 8. Acceptance and evidence

| Area | Automated coverage | Live acceptance checks |
| --- | --- | --- |
| Background audio | `test/audio.test.js`, `test/browser/audio.html` | Cold-load mute/preload; no native load before Play; silent Web Audio; native sound controls; AirPods phone-to-Mac check |
| Playback | `test/playback.test.js` | Paused load/scroll; muted start; unmute; pause/resume; end/replay; GIF; seeking; actual grey/color state |
| Feed | `test/feed.test.js` | Three For You buttons; Block elsewhere; matching author; layout and tooltips; approved account/feedback action and Undo |
| Download UI | `test/content.test.js` | Player/CC placement; GIF badge; right-click target; menu dismissal; keyboard access |
| Collector/worker | `test/extension.test.js` | Blob-backed player extraction; real MP4 save; correct media/filename; Chrome download status |
| Preferences | `test/preferences.test.js`, `test/popup.test.js` | Following default/manual override; live switches, persistence, save errors; timer placement |
| Time accounting | `test/activity.test.js` | Active/background tabs, focus loss, multiple windows, local midnight, reload and suspend |
| Local browser fixtures | `test/browser/playback.html`, `test/browser/feed.html` | Trusted input, actual media events, visible toasts, tab switching, simulated errors |

Baseline automated suite: **72 tests**. Run `npm ci`, `npm test`, and `npm run check`. CI runs the same commands on Node 24.

On 2026-11-07, real X pages were used to inspect and visually verify player controls, downloader paths, autoplay/loop prevention, muted playback, and post-shortcut placement/scope. Feed mutation/Undo sequences were exercised with synthetic native bindings in unit tests and a local Chrome fixture; real accounts were not arbitrarily blocked or given recommendation feedback for testing. Distinguish fixture validation, temporary page previews, and validation of the installed/reloaded extension in future reports.

Version 1.5.0’s settings popup, persistence, timer layout, and Following/manual-tab behavior were also checked in a local Chrome preview. Installed-extension checks are separate from those synthetic previews.

In 1.6.0 browser diagnostics on X found paused, unmuted, initialized video elements and no live realtime AudioContexts at the inspected moment. This suggests an early-media-initialization gap but does not prove the cause of Bluetooth handoff. A real Chrome fixture verified `readyState = 0` before Play, muted manual playback, rejected background unmute/audio requests, and `sinkId.type = "none"`. AirPods behavior remains a separate hardware check.

## 9. Non-goals and constraints

- No automatic liking, posting, following, feed curation, or account blocking without a deliberate shortcut click.
- No guarantee that a native X account change reverses every related platform side effect.
- No persistent Undo history, synced preferences, or automatic extension reload mechanism.
- No promises of compatibility with every locale, experiment, or future X layout. The repair process must preserve the behaviors above while replacing obsolete bindings.
- Screenshots, user downloads, account state, and temporary debugging captures are local QA artifacts, not repository content.
