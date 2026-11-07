# Maintaining Healthy Twitter against X updates

Last inspected: **2026-11-07**, extension **1.6.0**. Following selection and the counting timer were observed in the installed 1.5.0 extension; 1.5.1 removes its subtitle and fixes clearance below X’s fixed search header. Read [SPEC.md](../SPEC.md) first for the behavior a repair must preserve.

X's DOM, React tree, and internal action functions are not a supported public extension API. Keep the integration small, verify the current website directly, and update sanitized fixtures to describe the observed structure. Do not solve a broken selector by broadening the target until an unrelated post can match.

## 1. Start with the failing feature

| Symptom | Start here | Typical cause |
| --- | --- | --- |
| Video starts without a click | `playback.js`: `gesture`, media prototype wrappers, `stateFor` | New player surface, changed source lifecycle, or native autoplay bypass |
| GIF/video loops | `playback.js`: `canSeek`, `ended`, `syncPlayer` | JavaScript restart or changed X track loop setting |
| Video becomes audible immediately | `playback.js`: `syncPlayer` | X reapplies its stored mute preference after the native property is set |
| Pause/Replay is wrong | `playback.js`: `gesture`, `syncPlayer` | Multiple playback buttons or X's own loop/ended state |
| Paused media stays colorful | `playback.css`, `paint` | Poster moved outside the known player or changed background markup |
| No inline download button | `content.js`: `controlsFor`, `installButton` | Volume row, GIF badge, or control layout changed |
| Wrong/missing right-click item | `content.js`: menu markers and context tracking | Changed menu test IDs, GIF menu shape, or menu reuse |
| Download item works but menu stays open | `content.js`: `activate` | X's Escape handling moved; baseline requires keyup |
| Download finds no MP4 | `collector.js`: `playerProps`, `normalize` | Variants moved, source not mounted, or media is HLS-only |
| Wrong video/author is downloaded | `collector.js`, `background.js` | Traversal crossed a post or a targeted token fell back |
| No author-row buttons | `feed.js`: `identity`, `contextFor`, `install` | Article/header markers or native action props changed |
| Feedback buttons on the wrong tab | `feed.js`: `forYou` | Home tab order or selected-state markup changed |
| Show less only dismisses the post | `feed.js`: feedback payload/step stack | Only the first feedback key is transmitted by X |
| Undo loses one feedback step | `feed.js`: `remainingUndo` | Native feedback stack order or inverse semantics changed |
| Block targets the wrong account | `feed.js`: current DOM identity vs native tweet/user | Recycled nodes, quote/retweet attribution, or stale props |

## 2. Current DOM contracts

These are observations, not permanent interfaces.

| Marker/structure | Consumer and meaning |
| --- | --- |
| `[data-testid="videoComponent"]` | Player identity for playback, collection, and download controls |
| `video`, `source`, `src`, `poster` | Media/source lifecycle and direct MP4 fallback |
| `[role="slider"]` | Seeking and native volume/control-row discovery |
| Large Play SVG with `circle`; small control SVG `viewBox="0 0 24 24"` | Distinguishes overlay and control-bar playback buttons without English labels |
| `span` whose text is `GIF` | Compact GIF controls; source/poster URL also identifies GIF media |
| `[role="menu"]`, `[data-testid="Dropdown"]` | Native context menu and item list |
| `copyVideoLinkAtCurrentTimeContextMenuItem`, `postVideoContextMenuItem` | Recognizes the video menu without matching translated copy labels |
| `article[data-testid="tweet"]` | Feed shortcut boundary |
| `[data-testid="User-Name"]`, author/status links | Current author handle and post ID |
| `[data-testid="caret"]` | Post More control and the native action component above it |
| `[data-testid="cellInnerDiv"]` | Hide the enclosing timeline cell only when it contains exactly one article |
| `/home`, first `[role="tab"]` in `[role="tablist"]`, `aria-selected="true"` | Current For You heuristic; verify order before reusing after a redesign |
| `[data-testid="tweetText"]`, status links with `time` | Downloader caption and post metadata |

Generated `css-*` / `r-*` class names and minified component names are deliberately not selectors. Layout discovery uses flex rows and native controls. The feed button color comes from the timestamp/handle, not a possibly hovered blue More icon.

Owned markers must remain unambiguous:

- Downloads: `data-xvs-owned`, `data-xvs-player`, `data-xvs-action="download"`.
- Playback styling: video `data-ht-playing`, player `data-ht-state`.
- Feed: `data-ht-feed-owned`, `data-ht-feed-action`, `data-ht-feed-hidden`.
- Installation guards: `Symbol.for('healthy-twitter.playback')` and `Symbol.for('healthy-twitter.feed')`.

## 3. React and local player integration

React currently exposes an own DOM property whose name starts with `__reactFiber$`. Walk its `return` chain with a limit; do not depend on the minified component name. For connected class components, current `stateNode.props` can be newer than `memoizedProps`.

### Playback

Starting at the player's fiber, `syncPlayer` searches up to 12 ancestors for:

```js
fiber.stateNode.videoPlayer
api.video.getVideoTag() === exactVideoElement
api.mute()
api.pause()
api.video.getCurrentTrack()?.shouldLoop
api.video.shouldLoop
```

The exact video comparison is mandatory. Disable looping on the current track and local player, and synchronize native mute/pause state through that player's API. These operations do not make account API requests.

Two observed pitfalls are worth keeping as regression cases:

1. `video.loop = false` does not stop X from invoking `play()` or seeking back at the end. X's own track `shouldLoop` flag also determines whether its normal Replay UI appears.
2. `video.muted = true` just before `play()` can be undone by X's next render. Calling the corresponding local player mute action keeps the sound button and actual audio state consistent.

If this integration disappears, the native guard still catches many automatic starts/rewinds. That fallback alone is not proof that mute and Replay work correctly.

The native guard's current timing/state details are in `playback.js`:

| Detail | Baseline |
| --- | --- |
| Explicit Play intent | 1,200 ms, scoped to a player/video |
| Manual seek intent | 1,500 ms; pointer scrub remains authorized until release, then 500 ms grace |
| Automatic rewind heuristic | Finished, or an authorized session within 0.4 s of its end seeking backward over 0.5 s from a position over 0.5 s |
| Authorization end | Pause, end, failure, or replacement of an existing media source |
| Inactive styling | Until actual `playing`; restored on pause, waiting, error, and end |

Native `play`, `pause`, `currentTime`, and optional `fastSeek` are saved before wrapping. The playback/loop guard is video-only. `audio.js` runs first and separately protects all media audio output; preserve the wrapper ordering and the explicit-Play handoff. Do not pause a playing video during the capture phase of a normal Pause click: X's toggle will see the altered state and may play it instead.

### Media collection

`collectVideos` is serialized by Chrome, so keep it self-contained: imports or closure helpers will not accompany it into the page.

Current traversal: at most four DOM ancestors, then 32 fiber ancestors for each; stop at an article boundary. Relevant player props:

| Field | Use |
| --- | --- |
| `variants` | `src`/`url`, `type`/`content_type`, `bitrate` |
| `videoId.id`, `videoId.index` | Post association and media index |
| `contentId` | Duplicate-player identity |
| `contentType === 'gif'` | GIF detection |
| `poster`, `durationMs` | Media metadata; poster also helps GIF identification |

Accept progressive HTTPS MP4s on `video.twimg.com`, excluding known `/pl/` and `/aud/` fragment paths. Resolution usually comes from `/WIDTHxHEIGHT/` in the URL. GIF URLs under `/tweet_video/` lack dimensions; use decoded dimensions only if the candidate URL is the exact current video source.

When a player token is supplied, compare the attribute value directly and never fall back to another player. The collector retains an untargeted mode for fixtures/inspection (the settings popup no longer uses it); that mode may include standalone `<video>` elements and deduplicate by content ID or source.

## 4. Feed actions and their inverse operations

### Finding the exact action context

`feed.js` first derives the current post ID and handle from the article. It walks up to 80 fibers from the caret and article to locate matching native props. Revalidate identity at click time; never rely only on the context captured when a button was installed.

Required account bindings:

```js
props.tweet.id_str === currentPostId
props.tweet.user.screen_name // matches current author
props.tweet.user.id_str     // exact action target
props.tweet.user.blocking
props.block(userId, { promotedContent: props.promotedContent })
props.unblock(userId, { promotedContent: props.promotedContent })
```

Viewer identity is currently available as the action component's `context.viewerUserId` or an ancestor's `props.viewerUser.id_str`. Exclude own posts. Use the bound block/unblock functions directly after a trusted user click; the confirmation dialog belongs to a higher-level menu wrapper and is not part of this shortcut flow.

Required feedback bindings:

```js
props.entry.content.id // matches currentPostId
props.entry.itemMetadata.feedbackInfo.feedbackKeys
props.feedbackActions
props.applyFeedbackAction(payload)
props.undoFeedbackAction(payload)
```

The native Redux context currently appears in `fiber.dependencies.firstContext` / `next`, with a `memoizedValue.store`. Only the already-loaded feedback records are needed:

```text
store.getState().urt[<timeline-id>].responseObjects.feedbackActions[<feedback-key>]
```

Do not hard-code a timeline ID such as `home-graphQL`, a live feedback key, a user ID, or an authenticated request URL. Do not dump the entire store to logs or fixtures.

Select the root action with `feedbackType === 'DontLike'`, `hasUndoAction`, and membership in the exact entry's feedback keys. Its `childKeys` refer to the loaded record map. The account-specific child currently has `feedbackType === 'SeeFewer'`, `hasUndoAction`, and a prompt containing the current handle. A sibling `NotRelevant` action is **not** Show less from the account. Prompt-based association remains dependent on X's wording/localization.

### Feedback stack contract — preserve this order

The inspected native action sends **only `feedbackKeys[0]`** to X. The rest of the array records earlier feedback steps. Native Undo sends the inverse for the first key and restores the tail in the local timeline state.

Let `R` be the entry's Not interested key and `A` its account-specific Show less key:

| Operation | Call | `feedbackKeys` |
| --- | --- | --- |
| Not interested | apply | `[R]` |
| Show less, step 1 | apply | `[R]` |
| Show less, step 2 | apply | `[A, R]` |
| Undo Show less, step 1 | undo | `[A, R]` |
| Undo Show less, step 2 | undo | `[R]` |

Each payload also contains the matched `entry` and `isDismissibleFeedback: true`. Await each step. Sending `[R, A]` once does not apply both actions; it only submits the root feedback.

Track attempted steps before dispatch. If a later apply fails, roll back in reverse order. Pop an inverse from the pending stack only after successful Undo. Retain failed inverses for retry, including when the original article has unmounted. Native feedback dismissal may happen before a request resolves, so restoring only the extension's CSS is not sufficient rollback.

### Local UI state

Feed operations optimistically hide the selected cell; Block also hides mounted posts with the same author handle. If a timeline cell contains multiple articles, hide only the selected article. Recheck recycled DOM on later scans.

Each operation has its own Undo closure/toast. Pending requests hold the toast open. An early Undo waits for the forward request. Error paths explicitly clear local hiding when rollback succeeds, including X leave-behinds that no longer contain an article.

## 5. Download controls and menus

`content.js` runs isolated, so it sends `{type: 'download-player', playerToken}` to the worker rather than a page-provided URL. `background.js` validates the sender, injects the collector into that sender's top frame, selects its best variant, and validates the URL again before Chrome Downloads.

Regular control discovery looks for a flex row containing the volume slider and at least three native buttons; the seek slider is above that row. GIF discovery uses source/poster metadata or the GIF badge, then finds its compact flex row. Preserve a single download button across remounts and move the GIF fallback when controls become available.

Video menus have stable-looking test IDs for copy/post-video actions. The GIF menu has no equivalent marker in the inspected version, so its single-item Dropdown is associated with a recent trusted right-click on a GIF. Snapshot pre-existing menus and do not adopt an unrelated one. The association window is two seconds. A reused menu must update its target.

The cloned download menu item retains native presentation but strips native identifiers/data/ARIA attributes before adding its own. Keyboard navigation follows actual DOM items. Activation sends Escape keydown **and keyup**, then starts the download. Preserve this dismissal behavior when changing the menu code.

## 6. Repeatable repair workflow

1. Record the extension version, Chrome version, page type, and exact failing user action. Separate a popup/content-script reload problem from an X markup change.
2. Inspect the current DOM and only the nearest relevant React props/functions. Use a small public media example or a test account. Read-only inspection can verify bindings without submitting account feedback or blocking anyone.
3. Find the first broken assumption in the tables above. Keep post/player matching and URL/sender validation intact.
4. Build or update a **sanitized** fixture reproducing the new shape or state transition. Replace account data and opaque feedback keys with synthetic values. Do not commit tokens, full store snapshots, screenshots of the user's feed, or downloaded media.
5. Make the smallest adapter change. Avoid adding broad page permissions, hard-coded auth headers, private HTTP endpoint calls, or a downloader service to repair an internal binding.
6. Run the affected test file during iteration, then `npm test` and `npm run check` before publication.
7. Exercise the relevant local browser fixture with real trusted input. Unit tests stub media/native actions and cannot establish actual Chrome event ordering or current X compatibility.
8. Verify the UI on current X. Use disposable/test accounts or a specifically chosen target for real Block/feedback mutations; confirm Undo. A read-only layout check is not an end-to-end account-action test.
9. Bump `extension/manifest.json`, `package.json`, and `package-lock.json` for extension behavior changes. Reload the unpacked extension and refresh X tabs. Reinstalling is unnecessary; do not move the installed folder.
10. Verify the **installed** version after reload, update the inspected date/contracts in these docs, and describe which checks were live versus fixture-only in the commit/PR.

## 7. Local commands and browser fixtures

```sh
npm ci
npm test
npm run check

# Focused examples during a repair:
node --test test/playback.test.js
node --test test/feed.test.js
node --test test/content.test.js test/extension.test.js
```

Use Node 24 or newer. The committed lockfile makes the test environment reproducible. CI runs Node 24 and requires only read access to repository contents.

### Feed fixture

This fixture has synthetic React/native bindings and local sample accounts. It models the first-feedback-key contract, a short asynchronous delay, and a failure toggle. It performs no real account requests.

```sh
ht_qa_dir=$(mktemp -d)
mkdir -p "$ht_qa_dir/home"
cp extension/feed.js extension/feed.css "$ht_qa_dir/"
cp test/browser/feed.html "$ht_qa_dir/home/index.html"
python3 -m http.server 8766 --bind 127.0.0.1 --directory "$ht_qa_dir"
```

Open `http://127.0.0.1:8766/home/`. Check all three buttons, immediate hiding, Block affecting both sample posts from the same account, Undo, the recorded two-step feedback sequence, Following scope, keyboard focus, and simulated failure. Stop the server when finished.

### Playback fixture

Serve `test/browser/playback.html` as an `index.html` beside copies of `playback.js`, `playback.css`, and two user-supplied MP4s named `video.mp4` and `gif.mp4`. A short GIF-style MP4 and a video with audio are useful. The fixture attempts autoplay and JavaScript looping and reports actual media state. Test media stays outside Git.

The public posts used during initial development were:

- [Regular video](https://x.com/TTrending48/status/2118711616732598471)
- [GIF animation](https://x.com/JasonPremoMFG/status/2118722815356445088)

These URLs may disappear or change; they are optional smoke-test examples, not CI dependencies. Use another available post when necessary.

## 8. Installed-extension smoke matrix

| Scenario | Required observation |
| --- | --- |
| Fresh video/GIF, then scroll away/back | No autoplay; grey media; normal control contrast |
| Play, Unmute, Pause, Play | Muted start; manual sound works; resume muted |
| End and both replay surfaces | No loop; grey final frame; usable Watch again/Replay |
| Seek backward near the end | Explicit scrub succeeds; no automatic rewind |
| Player download, including paused player | Correct media saved; no playback toggle |
| Video/GIF right-click menus | Correct label and target; menu closes; native copy items remain |
| Two posts/quoted media on one page | Each download/action affects only its intended target |
| Settings popup toggles | Persist after closing/reopening; apply in open X tabs; failed saves shown |
| Enter Home, select For You, rerender, leave/return | Following default once; manual choice survives that visit |
| Timer with multiple tabs/windows and another app | One shared total; selected X tab in focused Chrome only |
| Timer across midnight and suspension | Local-day reset/split; no sleep accumulation |
| Timer disabled, then enabled | Stops counting, preserves today’s total, resumes without backfill |
| For You / Following / replies | Three shortcuts / Block only / Block only |
| Long author, dark theme, narrow window | Controls remain visible, legible, and usable |
| Not interested and Show less with Undo | Correct native feedback and full inverse sequence |
| Block with Undo | Exact user blocked/unblocked; affected posts restore |
| Pending action then immediate Undo | Inverse runs once after forward completion |
| Offline/error and retry | No false success; rollback/remaining Undo state retained |
| Rerender, navigation, recycled post | No duplicate controls or stale-target action |

Existing automated fixtures cover many edge cases; this matrix is a live compatibility checklist, not a claim that every website variant was tested.

## 9. Repository and release hygiene

- Keep `artifacts/`, downloaded MP4/WebM files, `.env*`, and `node_modules/` untracked.
- Review the staged file list and diff before pushing. Public post references and synthetic fixtures are fine; private account captures are not.
- Keep product requirements in `SPEC.md`, implementation contracts here, and first-time setup concise in `README.md`.
- A documentation-only change does not require an extension reload or version bump.
- If a change to X makes a feature unavailable, document the limitation precisely. Do not claim a live mutation succeeded based only on a mocked handler call or a visible button.


## 10. Settings, Home navigation, and time accounting (1.5.0)

Before debugging an apparent regression, check whether the relevant switch is enabled. `settings.js` defines the complete boolean schema and defaults. The popup stores only normalized `settings` in `chrome.storage.local`. `preferences.js` reads it in the isolated world at document start and broadcasts JSON through `ht-settings`; `settings-bridge.js` maintains a separate `Symbol.for('healthy-twitter.settings')` object in each world. The ready event handles script injection ordering. This bridge carries only UI behavior booleans, never storage access, account data, credentials, or commands. It is not a trusted boundary for account operations.

Playback keeps its prototype wrappers installed and branches on current preferences. It records native autoplay/loop requests and local X loop values so disabling protection can restore them. `data-ht-grey="false"` on the root disables the inactive CSS filter. Feed and download scripts rescan when preferences change. Outstanding feed Undo operations remain valid even if their shortcut is switched off.

`preferences.js` checks the first Home tablist and clicks its second tab once per `/home` entry. Selected-state attributes and a one-second route check handle delayed rendering/SPA navigation. Trusted user tab choices cancel pending default selection. If X reorders tabs or changes routing, repair this together with `feed.js:forYou`; a mismatched pair could put feedback shortcuts on the wrong timeline.

Timer DOM: `.ht-time-card`, owned by `data-ht-timer-owned`, is inserted at the start of `[data-testid="sidebarColumn"]`; without a visible sidebar it floats near the lower right. X currently has a fixed search-header ancestor above `form[role="search"]`; measure its bottom and set `--ht-time-top` so the sticky timer clears it by 12 pixels. Do not cover the search input. The timer’s `role="timer"` has `aria-live="off"`. If X changes sidebar layout or visibility, update mounting and verify wide/narrow layouts plus the presence of X’s own search/messages controls.

`activity.js` owns one serialized ledger in the service worker. Browser tab activation/removal/navigation and window focus events settle the previous interval and select the current eligible X tab. Five-second content heartbeats verify the selected tab and focused, non-minimized window through Chrome, checkpoint storage, and return the total. A second tab cannot add the same interval again. These APIs use existing X host access; there is no broad `tabs` or browsing-history permission.

Storage schema:

```js
settings: { /* only the named boolean keys in settings.js */ }
dailyUsage: { day: 'YYYY-MM-DD', milliseconds: 0 }
```

Only today’s total is retained. Live ownership/last checkpoint are memory-only, so restarting the worker/browser never backfills downtime. Split ordinary intervals at local midnight; discard gaps over 15 seconds as suspension. Normal heartbeats are five seconds, so abrupt termination may lose up to the latest checkpoint interval. This is a foreground-tab timer, not an idle-input detector.

Regression checks belong in `test/activity.test.js` (ledger/focus/ownership), `test/preferences.test.js` (navigation/mounting/bridge), `test/popup.test.js` (persistence/errors), and the existing per-feature suites (independent switches). The popup no longer scans media, chooses quality, or follows download completion. Keep the worker’s sender validation: `usage-get` only from the exact popup, `activity-pulse` and `download-player` only from same-extension top-frame X content scripts.

The green bird’s source is `extension/icons/twitter.svg`, adapted from Bootstrap Icons with its MIT notice alongside it. `npm run icons` uses the development-only `@resvg/resvg-js` package to regenerate PNGs; no rasterizer or other runtime library ships inside the extension. Keep the attribution when changing the artwork.

Official API references: [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [tabs and host permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [window focus](https://developer.chrome.com/docs/extensions/reference/api/windows).


## 11. Background audio and headphone focus (1.6.0)

A browser being silent is not proof that it never initialized an output device. X inspection found multiple videos at `readyState = 4`, paused but unmuted, while the old guard only muted at `play()`. No live AudioContext instances were found at that inspection point; do not report Web Audio as the confirmed cause. Chromium’s renderer has separate real/null audio sinks, and its media-focus bookkeeping considers whether media was previously unmuted. Early muting and deferring initialization address that gap. See [Chromium’s audio renderer](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/renderers/audio_renderer_impl.cc).

Required manifest order in the document-start MAIN-world entry: `settings.js`, `settings-bridge.js`, `audio.js`, `playback.js`. Loading the audio guard after X caches native constructors/methods or after a media pipeline exists misses the initialization window. Refresh all existing X tabs after reloading the extension.

`audio.js` protects media factories (`Document.createElement`, `createElementNS`, and `Audio`), media source/mute/defaultMute/preload setters, relevant attributes, `load()`, and audio-only playback. A mutation observer covers parser/cloned elements. Set native mute/defaultMute before handing a created node to X. `preload="none"` is a hint, so early `load()` calls are also deferred; the browser fixture demonstrated that calling native `load()` immediately can still fetch metadata. Flush the deferred load only when playback reaches the permitted native-play path. Preserve pending explicit Play through initial `emptied` events.

The playback guard calls `audio.beginPlayback(video, explicitIntent, startMuted)`. That allows a deliberately audible start when the Start muted setting is off, without letting X’s automatic retries authorize sound. Capture trusted clicks/pointer/keyboard actions on the volume slot. Current structural binding: the volume slider’s first ancestor with native buttons has exactly one button and one slider. The progress slider’s corresponding ancestor does not match. M inside the player is also a sound action. Check these bindings if X changes controls; never broaden to every page click. Native controls can bypass property setters, so guarded `play` and `volumechange` event handling is also required.

Web Audio uses a constructor proxy with Chrome’s no-output sink. It keeps real AudioContext objects and native graph methods, rather than pretending a context is suspended. `setSinkId` calls are serialized and re-check authorization before touching an output. Only a graph associated through `createMediaElementSource` with authorized playing media may use a hardware sink while protection is on. Native `close()` still releases the context; weak references avoid retaining retired elements/contexts. Offline contexts and microphone APIs are untouched. Chrome documents [no-output rendering and sink selection](https://developer.chrome.com/blog/audiocontext-setsinkid).

`preventBackgroundAudio` is independent of the existing playback switches. It can suppress notifications, Spaces, or call audio; the popup explicitly tells users to turn it off for those flows. Disabling it restores recorded requests and deferred loads. No new permissions are required, and this does not change system-wide sound, Bluetooth, or AirPods preferences.

### Validation

- `node --test test/audio.test.js`: early factory/source muting, background load/play blocking, explicit volume/native controls, per-player permission, pause/source revocation, no-output context construction, sink routing, disabling protection, and unsupported-browser failure.
- Serve `test/browser/audio.html` as `index.html` beside `settings.js`, `settings-bridge.js`, `audio.js`, `playback.js`, `playback.css`, and a local MP4 named `quiet.mp4` with an audio track. A synthetic silent AAC track permits checking audio plumbing without audible test tones. Keep that MP4 outside Git.
- Before Play: muted before source assignment, preload `none`, paused, no background audio start, Web Audio sink type `none`. In the tested Chrome fixture the video remained at readyState zero. After Play: time advances, video stays muted, background unmute remains blocked, and resumed Web Audio still uses no output. Then test native Unmute/Mute/Pause/Replay on an appropriate user-controlled media sample.
- On installed X, check cold Home, scrolling, newly inserted players, muted Play, explicit unmute, pause/replay, and downloads. MediaSource-based X loading may differ from a progressive-MP4 fixture; ensure Play does not depend on metadata that the new guard defers.
- For the actual reported symptom, play audio on the phone through AirPods, open a fresh protected X tab without touching a player, then deliberately Play muted. The AirPods should stay with the phone. Explicit Unmute may legitimately switch them to the Mac. Repeat after scrolling/new media. This physical check cannot be inferred from browser `muted`, readyState, or sink diagnostics alone.

If switching persists, capture whether it occurs at navigation, metadata loading, muted Play, or explicit sound. Investigate the actual active page/frame and native audio pipeline before adding broader monkey patches. The extension does not control every renderer process, foreign frame, microphone path, browser extension, or OS-level routing decision, so avoid promising a universal zero-session guarantee.
