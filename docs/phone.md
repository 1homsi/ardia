# Ardia for phones (Expo)

One Expo app for both phones, replacing `apps/ios` (SwiftUI) and `apps/android` (Compose) step by step (issue #1556).
Screens, app state and the data store are TypeScript; what has to be native is an Expo module wrapping the Kotlin and
Swift code that already exists. Both phones run it: Android and the iPhone.

## Layout

```
apps/phone/                 the app, and the root of its own pnpm workspace with packages/phone: Expo 58, React
                            Native 0.88.1, React 19.3, Reanimated 4.7, Worklets 0.13, Gesture Handler 3.3, Hermes V1
  android/                  the Android project, checked in (application id com.ardia.browser.android, minSdk 29,
                            arm64-v8a and x86_64)
  src/                      the Mac's folder rules (docs/conventions.md): components/ui, components/<feature>,
                            state/<domain>, platform, lib
  ios/                      the iPhone project, checked in (bundle id com.ardia.browser.ios, the SwiftUI app's, iOS 27,
                            iPhone only, React Native's prebuilt core)
  scripts/gradle-locked     Gradle under the same lock as apps/android, so one Android build runs at a time
packages/phone/             @ardia/phone-native, the Expo module package
  src/                      the TypeScript side: PageView and its types
  android/                  the Kotlin side. Its Gradle build compiles apps/android/browser's sources, assets and
                            resources directly (namespace com.ardia.browser), so both apps run one PageEngine
  ios/                      the Swift side, pod ArdiaPhoneNative. It builds against ArdiaKit's ArdiaBrowser, so the
                            SwiftUI app and this app run one WebEngine and WebTab
```

`@ardia/core` is imported straight from `src/mobile.ts`; no bundle, no script engine.

The phone is its own pnpm workspace, apart from the Mac's, so the two apps can run different Expo and React Native
versions (decided 2026-11-15 for the move to Expo 58 and React Native 0.88, which the Mac can't follow: Expo 58 has no
macOS and react-native-macos stops at 0.83):
- `apps/phone/pnpm-workspace.yaml` holds `apps/phone` and `packages/phone`, with its own `pnpm-lock.yaml` and a
  hoisted `apps/phone/node_modules`. `@ardia/core` comes in as `link:../../packages/core`; it imports only `node:`
  modules. The root workspace leaves both out. Install with `scripts/agent/locked pod -- pnpm -C apps/phone install`.
- Nothing of the Mac's is on the phone's resolution path. Metro reads only `apps/phone/node_modules` and watches
  `packages/phone` and `packages/core`. TypeScript keeps symlinks (`preserveSymlinks` in the three tsconfigs), so
  `packages/phone` is read through `apps/phone/node_modules/@ardia/phone-native` and its imports find the phone's
  modules; tests import it by that name, never by a relative path. `customConditions: ["react-native"]` and
  `moduleSuffixes: [".native", ""]` resolve types as Metro resolves code. Jest's `test/render/resolver.js` resolves a
  bare import from `packages/phone` as if from `apps/phone`, through Reanimated's own jest resolver.
- Why not one workspace: with the hoisted linker one copy of `react-native` and `expo-modules-core` sits at the root,
  and whichever version pnpm picks is what `packages/phone` (whose React Native is a peer) and Expo's autolinking see.
  A Mac dependency change could flip it, and one install rewrote both apps' trees.

## The page view

`PageView` (`packages/phone/src`) is the page. Android backs it with `PageEngine` from `apps/android/browser`
(`DevelopmentWebViewEngine` over the system WebView today). The iPhone backs it with `WebEngine` and `WebTab` from
`apps/ios/Packages/ArdiaKit` (WKWebView with the SwiftUI app's content blocking, popups, downloads and page requests),
in an in-memory tab store until this app takes over the SwiftUI app's data. Its tone is `PageTone.resolve` and
`ToneSampler` in ArdiaBrowser, the code the SwiftUI app's bar uses. The page takes iOS's edge swipes for back and
forward.

- Props: `pageId` (a page lives in the native engine under this id and survives remounts), `initialUrl` (loaded when
  the page is first opened), `toneInsets` (dp at the top and bottom to leave out when sampling the page's tone).
- Events: `onPageState` (`url`, `title`, `progress`, `isLoading`, `canGoBack`, `canGoForward`) and `onPageTone`
  (`top`, `bottom` as `#RRGGBB`, already resolved from theme colour, background colour and the sampled bands). Native
  sends both on one `onPageEvent` channel; the wrapper splits them.
- Handle: `loadUrl`, `goBack`, `goForward`, `reload`, `stopLoading`. `closePage(pageId)` ends a page.

**What the Codex review of 15 November changed** (Android).
- A page's picture is published by generation (`<stem>-<generation>-WxH.jpg`), so a newer capture always wins. Its
  decoded bitmap stays pinned in Fresco's cache under the file's URI until the JPEG lands, then
  `page.snapshotLanded` announces it. The tab's saved row keeps the last durable URI until then (fb35ea88d native,
  ddb3463ad JS).
- A closed page's pictures are cleaned up by the page's lifetime, not its id, so a reopened id never loses a live
  page's files (fb35ea88d).
- Android's camera, microphone or location dialog is raised only for the page on screen (activity resumed, page
  view at least half visible), one at a time, and a closed page's ask is dropped. An ask lost to activity
  recreation or a JS reload is asked again: the first answer wins, and one granted in the meantime skips the dialog.
  An unanswered request is sent again when JS reopens a page it was already watching (07fca2a67).

`browser`'s `Omnibox.kt` (the ScriptEngine bridge) and `PageSurface.kt` (Compose) are left out of the module's build:
the Expo app calls `@ardia/core` itself and hosts the page's view natively.

## Sync on Android

Sync is a native subsystem with its own script runtime; the app's JavaScript never sees the host functions,
keys, the phrase's entropy or sealed bytes. `@ardia/phone-native` compiles `apps/android/sync` and
`apps/android/shared` in place, and `ArdiaPhoneSync` (`packages/phone/src/sync.ts`) wraps `SyncController` whole:
status and the synced view as getters and events, connect and change folder with the system folder picker, sync
now, stop, the reset notice, device name, profile, send, pin to Mac, incoming sends. One controller owns every
cycle on its own thread; `MainApplication` is the `SyncControllerOwner`, so WorkManager's `SyncWorker` (every 15
minutes, and a flush after the app leaves the screen) runs it without React Native.

- **Runtime.** `ardia_hermes.cpp` builds against React Native 0.88's prefab Hermes V1 (`hermes-engine::hermesvm`),
  JSI and fbjni, the same Hermes line the Compose app ships (260318099.0.5), so the process has one Hermes and
  sync gets its own runtime instance. `libardiahermes.so` needs only the `libhermesvm.so`, `libjsi.so` and
  `libfbjni.so` the app ships. A store build defines `ARDIA_SCRIPT_QUIET`, so the sync script's `__log` writes
  nothing to logcat; a lab build logs it as `ArdiaJS`.
- **Bytecode.** `CompileSyncBundle` (`packages/phone/android/build.gradle`) compiles `ardia-sync.js` as it is, with
  `hermes-compiler`'s `hermesc` and `-Xes6-block-scoping`, as the Compose app does. It refuses to run unless
  `hermes-compiler` and React Native's Hermes (`sdks/hermes-engine/version.properties`) are both 260318099.0.5 and
  the `hermesc` binary matches its pinned sha256, so the bytecode always matches the runtime that loads it. The
  whole companion suite (`packages/sync/src/companion`) runs against the bundle first. Under React Native 0.81 the
  bundle went through Babel's class, block-scoping and async transforms because that Hermes rejected them; Hermes V1
  runs them natively, so the Babel step and its pins are gone. A lab build also compiles the runtime checks
  (`sync-runtime-checks.js`) and the results Node gives for them, which the lab compares with Hermes V1's on the phone.
- **The phone's data.** Sync reads the app's `browser.db` (`filesDir/SQLite`, written by expo-sqlite) read-only
  on its own thread: open web tabs, the 30 newest per profile, and visits grouped by address and profile. A
  missing database is an empty phone; one that cannot be read fails the cycle. The app never writes private
  tabs or their visits to it. Its tables are the Kotlin store's: `tabs`, `tab_state` and `visits` have the
  same columns and indexes, `PRAGMA user_version` is 1 in both and both use WAL. The differences: the Expo
  file adds a `preferences` table (the Kotlin app keeps preferences in SharedPreferences), Android's
  `SQLiteOpenHelper` adds `android_metadata` to the Kotlin file, and nothing marks a row as private in either
  file (the Kotlin app keeps private tabs in memory, the Expo app never writes them). The Kotlin `store`
  module's readers are not reused: `BrowserDatabase` opens the file to write and migrate, and `TabStore`
  answers sync from its in-memory state.
- **Sync's writes to the phone's data.** Tabs a Mac sent and history a Mac removed go to an inbox file next to
  the sync state (`noBackupFilesDir/PhoneSync`), written whole and renamed into place, until the app applies
  them to its store (`sync.inbox()`, `sync.inboxApplied(ids)`, the `sync.inbox` event). Visits waiting to be
  removed are left out of what sync reads, so they never go back to the Mac.
- **Lab.** The page lab's Sync button connects with a typed phrase and a picked folder and shows the status and
  the synced view's counts. Runtime checks runs semantic fixtures (closures in loops, microtask order around a
  host call, sort stability, Map and Set order, large integers, string comparison) in a second sync runtime and
  prints `PAGELAB PASS` or `PAGELAB FAIL` per check against Node's results from the build.

#### Sync tester script (lab build, a Mac with sync on)

Watch `adb logcat -s PAGELAB ArdiaJS` throughout. Each step passes when the app keeps working, the status
says what happened, and no tab or removed visit is lost or shows up twice.

1. **Connect.** Sync › connect with the Mac's phrase and its folder. Status reaches `updated`; the view lists
   the Mac, its profiles and its tabs.
2. **Runtime checks.** Every check prints PASS.
3. **Next profile.** Each tap moves `›` to the next profile, and `shown` follows it.
4. **Two runtimes under teardown and reload.** Tap Runtime checks, and while it runs tap Sync now; then reload
   the JavaScript (debug build: `r` in Metro; release: kill the app with `adb shell am kill` after leaving it).
   Repeat three times. Sync keeps cycling, the checks still pass, and nothing crashes (`adb logcat -b crash`).
5. **A slow or revoked folder.** Point sync at a folder on a provider that lags (a cloud drive's folder with
   the phone on a slow network): status shows `updating`, then `updated` or `stalled`, never a hang past a
   minute. Then revoke the grant (Settings › Apps › Ardia › clear the folder permission, or remove the folder in
   the provider): status turns `needsFolderAccess`, and Change folder recovers it.
6. **WorkManager with the app process dead.** Make a change on the Mac, leave the app, run
   `adb shell am kill com.ardia.browser.android`, then
   `adb shell cmd jobscheduler run -f com.ardia.browser.android <job id>` (ids from
   `adb shell dumpsys jobscheduler com.ardia.browser.android`). Open the app: the change is there before the
   first foreground cycle, and the inbox holds any tabs the Mac sent.
7. **Stalled age.** Turn on airplane mode and wait three minutes: the status reads `Last synced N minutes ago`
   and N moves each minute.
- **Scanning the phrase.** The module's own `ScanView` (`scanner`, `@ardia/phone-native`) scans the Mac's QR code
  with the Compose app's CameraX and ZXing code and hands the text to `sync.connect`; expo-camera and its ML Kit are
  gone (00b9064e9). It asks for the camera again once a one-time grant has expired (d8460729e).

## System entry points on Android

The Expo app has the Compose app's entry points (`docs/android.md`), from its own code where it can be shared.
- **Links.** `MainActivity` hands every intent to `PhoneSystemLinks` (`@ardia/phone-native`), which maps it to
  a `SystemLink` with the Compose app's `SystemLink` parser and queues it until the app listens
  (`system.initialLink()`, `system.addLinkListener`). http and https `VIEW` (default browser) is `open`, source
  `web`; `ardia://` from widgets and the tile is its kind, source `system`, and from launcher shortcuts, source
  `shortcut`; `WEB_SEARCH` and `PROCESS_TEXT` (Search in Ardia on selected text) search, or open a web
  address, source `intent`; `SEND` text opens its first link or searches the text, source `share`. A link is
  delivered once, not again on recreate or from Recents, and a new activity drops links an earlier one left
  untaken (50824c133). `system.setHidesFromRecents(hidden)` is the Compose
  app's Recents screenshot and `FLAG_SECURE` handling, for the screens to call while a private tab shows.
- **Default browser.** `defaultBrowser` uses the Compose app's `AndroidSystemActions` (`RoleManager.ROLE_BROWSER`).
- **Tile, widgets and shortcuts.** The Compose app's `SearchTileService`, Glance widgets (Search, Your Mac's Tabs)
  and `SystemSnapshots` compile in place in the Expo app, with its `res-system` resources and a small
  `ardia-design` library for `ProfileLook`, `Monogram` and `Colors`. `SystemExport` writes the widgets'
  snapshot from the wrapped sync controller, as the Compose app does; demo mode feeds no widgets.
- **Not ported.** Nothing: the share sheet (Open, Search, Send to Your Mac) and the widgets' Color tint are in.
- **Files.** A file request carries `offersPhoto`, `offersVideo` and `capturesDirectly` (the Compose app's
  `FileChooserPlan`); the answers `takePhoto` and `recordVideo` capture through the shared capture provider.
- **Open App Links In.** A global default (`pages.appLinksDefault`, `setAppLinksDefault`) with each site on,
  off or following it (`setOpensLinksInApps(host, null)`).

**What the Codex review of 15 November changed.**
- A share sent with Ardia cold waits for sync to load before it gives up. It is recorded before the wait, and a
  WorkManager job resumes it if the process dies. The sheet's ViewModel holds one key, so rotation never sends
  twice. Only sane extras are read (e8b5c7798).
- Native counts, such as the share sheet's tabs_sent, are kept only while usage sharing is on and within its
  consent generation. Turning sharing off clears them, and handing them to JS can lose a count but never double one
  (61df46a9a native; JS tells native the choice at start and on each change, 20e253b30).
- The tray's back callback is released with its module and rebound after activity recreation (8a9692af3). JS
  enables it only while nothing covers the tray (f7b1b8f87).
- The R8 name check finds Room's `WorkDatabase_Impl` constructor as one `<init>` method record with a `()V`
  descriptor (998f62979).

- **Sync is not offered in Android release builds** (the first Android release ships without it; lab builds keep
  it). One value, `SyncOffer.isOffered` in `packages/phone` (true in a lab build, false in a release build), decides
  every native entry point; JavaScript reads the same through `system.syncOffered()`. In a release build:
  - the share sheet offers Open in Ardia and Search in Ardia only, no Send to Your Mac and no hint to turn sync on;
  - the Your Mac's Tabs widget is not in the widget picker: its receiver is disabled by the build's
    `@bool/ardia_sync_offered`. A Your Mac's Tabs widget placed by a Compose tester build loses its provider, and
    the launcher shows that it can't be loaded until it is removed; no released build ever placed one;
  - the Your Mac's Tabs launcher shortcut is disabled the same way, and an `ardia://mac-tabs` link does nothing;
  - no sync controller is made, so nothing syncs, in front or in the background. Sync work a Compose tester left
    queued (`ardia-sync`, `ardia-sync-flush`) is cancelled at start, and a worker that runs anyway holds;
  - the sync code scanner reports the camera as unsupported and never opens it;
  - a Compose tester who had sync connected keeps the sync identity on disk untouched and unused; nothing is reset,
    so a later build that offers sync finds it as it was.
  `apps/phone/test/r8/check-names.py` lists the components the value switches and its value in the build.

#### Entry points tester script (lab build)

Before any run, prove the phone has the build you were sent:
- Clear old Ardia APKs from the phone's Downloads first, so an on-phone installer cannot pick an old one
  (sync13 on the M3 once installed sync12 that way): `adb shell ls /sdcard/Download | grep -i ardia`, then
  `adb shell rm /sdcard/Download/<each old ardia apk>`.
- After installing, hash what is installed and compare it with the `sha256:` line of the build's `.txt`:
  `adb shell sha256sum $(adb shell pm path com.ardia.browser.android | sed -n 's/^package://p' | grep base.apk)`.
  An `adb install` of a single APK keeps it byte for byte as `base.apk`.
- On the first launch logcat has `PAGELAB build <commit> dirty: no …`, and the commit must be the one sent
  with the APK. If the hash or the commit differs, stop and reinstall: nothing measured on the wrong build
  counts.

`P=com.ardia.browser.android/.MainActivity`. Open the lab
(`adb shell am start -n $P --ez com.ardia.phone.PAGE_LAB true`), tap System, and watch
`adb logcat -s PAGELAB | grep "PAGELAB system"`. Each command should print one `PAGELAB system link`
line with the kind and source shown. The lab also prints `PAGELAB system default browser` once when it opens
and again only when that status changes.

1. **Web link:** `adb shell am start -a android.intent.action.VIEW -d https://example.com/a -n $P`: open, web.
2. **Ardia links:** the same with `-d ardia://search?q=otters` (search, query otters), `ardia://voice`
   (voiceSearch), `ardia://incognito`, `ardia://mac-tabs` (macTabs), `ardia://tab/t1` (tab, id t1),
   `ardia://open?url=https%3A%2F%2Fexample.com%2F` (open), `ardia://inbox`: each with source system.
3. **Shortcuts:** long-press the app icon: Search, Voice Search, Incognito Tab, Synced Tabs each give their kind
   with source shortcut.
4. **Web search:** `adb shell am start -a android.intent.action.WEB_SEARCH --es query "red pandas" -n $P`:
   search, intent. With `--es query https://example.com/`: open.
5. **Selected text:** select words in any app, choose Search in Ardia: search with the words, intent. Or
   `adb shell am start -a android.intent.action.PROCESS_TEXT -t text/plain --es android.intent.extra.PROCESS_TEXT "two words" -n $P`.
6. **Share:** share a page from another app and pick Ardia: open, share. Or
   `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Look https://example.com/b." -n $P`
   (open https://example.com/b) and with `"just words"` (search).
7. **Once only:** after a link, go to Recents and back to Ardia, and rotate if the screen allows: no new line.
8. **Cold start:** force-stop the app, then run step 1 with `--ez com.ardia.phone.PAGE_LAB true` added: open
   System; the initial link line shows the link.
   Expected on every cold start, as in both native apps, and not a failure: with Auto-Open Keyboard on the app
   opens on the start page with the tray and keyboard up over the start page's backdrop (its logo and bar faded out,
   so nothing else shows behind the tray), never over the last page or the deck. Back closes the tray onto the
   selected tab. Report only a white or empty frame behind the tray, which e10082e90 removed.
9. **Default browser:** the status line shows isDefault and canAsk; Request role shows the system dialog and
   the line follows the answer; Default apps settings opens the settings page.
   `adb shell cmd role get-role-holders android.app.role.BROWSER` agrees. With Ardia as the default, step 1
   without `-n` opens Ardia directly.
10. **Recents:** Hide from Recents, then open Recents: Ardia's card is blank. Show in Recents restores it.
11. **Quick Settings tile:** add Ardia's Search tile; tapping it opens Ardia with a search link (system). With
    the phone locked it asks to unlock first.
12. **Widgets:** add Search and Your Mac's Tabs from the launcher's widget picker. Search: the field gives
    search, the mic gives voiceSearch. Your Mac's Tabs with sync off: "Sync With Your Mac"; with real sync
    connected, the Mac's tabs within a cycle, and a row opens its page (open, system). Dark mode switches the
    Search widget's backdrop.
13. **Take Photo and Record Video:** load
    `data:text/html,<input type=file accept=image/*><input type=file accept=video/* capture>` in the lab and
    tap each input: the request line shows photo/video/direct; Take photo asks for the camera once, opens the
    camera, and the page gets the picture; the second input (capture) records video.
14. **Desktop Site on the POCO F4** (it failed there on `sync3`): Desktop on for google.com, github.com,
    wikipedia.org and bbc.com. The `PAGELAB desktop` lines should show `switched on`, then `pageFinished` at
    the tag's scale (visualViewport.scale about 0.38, not 1.0000) with no visible jump, and each page fitting
    the width. GitHub at 980 px shows its narrow layout, as Chrome's desktop mode does on phones.
15. **Sync, demo mode:** Before the demo launch, note the deck's real tabs. The demo shows its own eight tabs (Sintra
    selected), four archived and its own history; open, close, archive and move tabs freely, then relaunch without the
    demo: the real tabs, their pictures and scroll positions are exactly as before, and tabs a Mac sent during the demo
    arrive then. Stop Syncing turns the demo off (the card and the deck show the disconnected state);
    the next demo launch is on again. A rename shows in the devices list; Pin to Mac fills the star. Damage inbox
    in the Sync section sets the status's `inboxProblem` (the Sync section's status lines show it) and the app
    shows its notice; after a force-stop and relaunch the notice is still there, until sync next writes the
    inbox.
16. **Shortcuts with the app in the background:** open the System section, press Home (don't swipe the app
    away), and use each launcher shortcut. Ardia comes back without restarting (the lab is still open, no
    splash) and prints one link line with source shortcut. `adb logcat -b main | grep -c "Unable to find viewState"`
    stays 0.
17. **Not yet covered:** the tile with the phone locked behind a PIN (it asks to unlock, then opens the
    search); the Search widget's mic (at its medium size, 4×2: the Compose widget shows the mic only from 250 dp
    wide); Search in Ardia on text selected in a real app; a share from a real app (Chrome's Share › Ardia).
18. **Widgets and dark mode:** with the app in the background, switch the phone between light and dark: both
    widgets' backdrops follow within a second.
19. **Scanner:** Scanner section › Ask for camera, then point at the Mac's sync code: one
    `PAGELAB scan code: N characters, 24 words, valid true` line and nothing with the words; another QR code
    gives `rejected`. Pause stops the camera (its light goes off). The phrase never appears in logcat.
20. **Voice:** Voice section › Ask for mic, Start, speak: `PAGELAB voice partial "…"` lines and one `final`
    line; Stop ends it; a silent start ends with `failure nothing heard`. In airplane mode, note whether words
    still arrive (they do when the phone has an on-device recognizer).
21. **Swipe and pull:** on the lab's page after two navigations, with Swipe anywhere: a drag right from mid-page
    goes back, left goes forward, short drags spring back; a horizontally scrolling area (a carousel) scrolls
    instead. Swipe edges: only drags from within a finger's width of the edge navigate. Pull on: at the top, a
    pull past the arrow's full turn taps a haptic and reloads with the spinner; scrolled down, a downward drag
    scrolls.
22. **Online again and favicons:** System › Favicon looks prints three lines with tones and backings; turn
    airplane mode on and off: `network lost`, then `online again` once.
23. **Accessibility dump:** in the app (not the lab), open the tray, the page menu, a long-press menu, Spaces
    and the Archive sheet in turn, and with each open run
    `adb shell am broadcast -a com.ardia.phone.A11Y_DUMP -p com.ardia.browser.android` and
    `adb logcat -d -s PAGELAB | grep "PAGELAB a11y"`. The lines between `begin` and `end` are what TalkBack can
    reach; the surface behind a cover should not be among them.
Look checks (24, 25, 32, 33, 38) start from the look on. The lab's Look on/Look off switch lasts across launches
and app updates, so before the first of them open the lab's Look, set Look on (logcat `PAGELAB look views on`),
force-stop and reopen the app. The deck's `PAGELAB look deck draws …` line then ends in `look on`, not `look switched
off in the lab`.

24. **Look:** the lab's Look section. Look plum/green/orange/incognito: the deck backdrop's blobs move (still
    with Reduce motion), incognito draws dark even in Light; the middle tile with Fades out goes from the backdrop
    at the top to the plain system background by 80% of its height; each Frost variant shows the blobs blurred
    behind it.
25. **Frost over a page:** in the Look section, scroll the Wikipedia page under "Sheet frost over the page" and
    watch `adb logcat -s PAGELAB | grep "look frost"`. The line `path=live (page under the frost, redrawn every
    frame)` means the blur is drawn from the page: the frost should show the page blurred and follow the scroll.
    If it is black, grey or frozen, tap Probe frost (one line with the frost's mean brightness and near-black
    share), then Page frost solid: the line says `path=solid` and the frost turns the sheet's plain colour. Report
    which one the phone needed.
    From sync12 a frost over a page is solid by default (`path=solid (page under the frost, solid page mode)`):
    blurring a page records its WebView into an offscreen layer, which blanked the page for 3 to 4 frames on the
    M3, and the Compose app never blurs a page. The lab's Page frost live is there for comparison only.
26. **Telemetry, nothing while off:** watch `adb logcat -s PAGELAB | grep telemetry`. With sharing off (a fresh
    install starts off), use the app for a minute, background it and come back: no `PAGELAB telemetry posted`
    line. Turn on "Share anonymous usage stats" in Settings, background the app: lines appear
    (`POST ardia.dev/otel/v1/logs -> 200`). Turn it off: no more lines. The same switch is on onboarding's last
    steps (Settings › Show Onboarding). Settings › What’s Sent lists what is counted. A lab release build sends to
    ardia.dev with environment test.
27. **Memory after tabs close** (the lab broadcasts here and below, MEMORY, FRAMES, TRIM and DECK_PARTS, are
    answered while Ardia is in front. From sync20d its receiver also stays registered in the background, but
    Android 14 and later, and MIUI's freezer, hold a broadcast to a cached app until it is back on screen. For the
    background itself use `adb shell dumpsys gfxinfo $P` and `dumpsys meminfo $P`.)
    `adb shell am broadcast -a com.ardia.phone.MEMORY -p com.ardia.browser.android`
    and `adb logcat -d -s PAGELAB | grep "PAGELAB memory"` (or System › Memory) at four points, after a
    force-stop and cold start each time you start over: with one tab; after opening nine tabs and visiting each;
    after closing eight of them; and after `adb shell am broadcast -a com.ardia.phone.TRIM -p
    com.ardia.browser.android` (System › Trim, the same clear Android's low-memory signal does). Report the four
    lines; the image cache's MB should fall when tabs close.
28. **Scanner without a camera:** Scanner section with the camera allowed: Feed a phrase code gives
    `code: … 24 words, valid true`, Feed another code gives `rejected`; no recovery phrase in
    `adb logcat -d | grep -i -E "abandon|zoo|^[a-z]+( [a-z]+){23}$"` or anywhere else. After an "Only this time"
    camera grant expires, Ask for camera shows Android's prompt again, not Allow Camera Access.
29. **Swipe over a carousel:** as in step 21 with Swipe anywhere, a sideways drag that starts on a carousel that can
    scroll that way scrolls it (logcat: `PAGELAB swipe left to the page`), and only a drag the carousel cannot
    take navigates.
30. **No replayed link:** open the Voice Search shortcut, leave the app in the background, then
    `adb shell am start -W -a android.intent.action.VIEW -d https://example.com/ --activity-clear-task -n $P`: the
    app opens example.com, not the voice screen.
31. **Widgets in both modes, quickly:** with both widgets on the home screen, switch dark, light and dark again
    within 20 s: each switch updates the whole widget (panel, pill, text, icons) together within a few seconds,
    and the Search pill shows its icon and label in both modes.
    Since the widgets carry both modes' colours (Android 12 and later), also add each widget once in light mode
    and once in dark mode, then switch modes with the app closed (`adb shell am force-stop $P` first): every
    widget follows within a few seconds whichever mode it was added in, its panel keeps a gradient, and the
    pill, icons, label and text all change together. Watch `adb logcat -s ArdiaWidget`: each update logs
    `widget search|macTabs update on API N: the launcher picks day or night …; the app sees day|night`. A switch
    with the app closed needs no update line at all. If a widget doesn't follow, report whether any line
    appeared and what it said.
    With TalkBack on, each widget reads its name from the moment it is placed, before its first update: "Ardia
    Search" and "Ardia, Your Mac’s Tabs", never "Ardianull".
    MIUI's launcher reads its own frame around a widget as "Ardianull"; the Compose app's widgets read the same on
    the same launcher (F4, sync12), so it is the launcher's and is not checked further.
32. **Deck backdrop:** in the app's deck, three slow blobs in lighter shades of the profile colour drift over the base
    (two screenshots 10 s apart differ). In the lab, Look: the stage above the frosted bar shows the mesh and blobs
    in every look, its caption sits at the bottom of the stage, and the frosted bar's label is centred. Tap Probe
    frost: `PAGELAB look deck probe:` gives each deck's size (never `0x0`), frames and fps (about the panel's rate
    while moving, 0 more frames while still), and three `probe pixel` lines. The centre pixel is close to the
    `mesh centre` colour, and the blob 1 pixel is lighter than it in light mode. `PAGELAB look deck size` and
    `first frame` lines appear once per deck. A look view that cannot draw shows a flat colour and logs
    `PAGELAB look <View> could not draw …` once instead of crashing; report any such line.
33. **Frost:** open the tray over the deck in dark mode. Behind the suggestion rows, the deck bar's three buttons
    show only as soft smudges, never as sharp icons. In the lab's Look, the frosted bar over the stage is the
    stage's colours blurred in every look (green: blurred green and blue, not flat lavender), and over incognito
    its label is white. The sheet frost over the page follows the page as it scrolls. Probe frost logs
    `path live` for both lab frosts, never `inside its own source`, each with its frost and source sizes.
    Every frost logs `PAGELAB look frost <name or source/variant #n> WxH path=… (reason)` whenever its path
    changes, so a button without glass shows why. Over a still page the tray's frost redraws a few times a
    second, and every frame only while the page scrolls; measure with the look on and off as in step 38.
34. **Voice screen in light mode:** the backdrop is the dark profile backdrop, with the white "Listening…", X and
    stop button readable on it, the same as in dark mode.
35. **Swipe over a carousel, both ways:** with Swipe anywhere, on a page with back history and a sideways
    carousel (a news site's story strip), scroll the carousel partway, then drag it right and left. Both drags
    scroll the carousel and neither navigates. Each drag logs `PAGELAB swipe decide …`, with the page's own
    scroll, history, the scroller report (`LR`, `-R`, `L-` or `not reported`) and the choice. A right drag on the
    carousel then logs `swipe left to the page … the scroller under the finger can scroll back` or
    `the page asked to keep it N ms after touch down`. A right drag on plain text, away from any carousel, still
    goes back (`swipe back claimed …`).
36. **Offline page:** load a page, turn on airplane mode, then open a new page and reload the first. Each tab keeps
    its last real title, or shows the address's host when it never loaded: on the deck, in the Archive, in the page
    menu and in History, never "Web page not available". The deck card keeps the page's last good snapshot (or
    the placeholder), never the WebView's white error page. Also open three heavy pages one after another (Wikipedia, github.com, bbc.com/news): each
    draws within a few seconds. If one stays pink or white, report the `PAGELAB page view …` lines from opening it
    (`shows its WebView at WxH`, `taken from another view`, `lost its WebView`, size changes). In dark mode the bottom bar stays dark over the
    offline view. Turn airplane mode off and tap Try Again: the real title, colours and a new snapshot come back.
37. **Memory after closing tabs:** as in step 27 (one tab, nine tabs, close eight), tap Memory after each stage. The
    image cache line now reads `X MB in N images (shown A MB in a, kept B MB in b)`. Each close logs
    `PAGELAB memory page closed: …` and `PAGELAB memory page snapshots deleted: F file(s), dropped D decoded, …`.
    The close and the delete run at once on different threads, so whichever runs first drops the decoded images:
    when the delete wins, the close says `no snapshot files left (…)` and the delete line carries the drops. For
    a tab that had a card, one of the two lines drops 1 or more; report any close of a carded tab where both say
    0. The image cache after closing eight is no larger than with nine open. Then run
    `adb shell am send-trim-memory com.ardia.browser.android RUNNING_CRITICAL` (Android's own signal, which
    also trims the system's GPU caches; the lab's Trim only clears the image cache) and tap Memory again. Report
    all the lines, graphics included.
    - Each Memory line now ends with `look on|off: N of M frost(s) blurring, about X MB of blur layers (largest …),
      D of E deck backdrop(s) shown`, and a trim logs `PAGELAB memory trim level L: image cache cleared; look
      trimmed: …`. Do the one-tab and nine-tab stages twice, look on and look off (step 38's switch, force-stop
      between), so the look's share of graphics shows.
    - Android only releases GPU caches, the WebViews' tiles included, at "UI hidden" or deeper, not at
      `RUNNING_CRITICAL` with the app in front. So also press Home, run
      `adb shell am send-trim-memory com.ardia.browser.android UI_HIDDEN`, come back and tap Memory.
38. **Frames with and without the look:** measure twice, look on and look off, doing the same thing each time.
    - In the lab's Look, set the toggle (Look on or Look off; it logs `PAGELAB look views off|on` and lasts across
      launches), then `adb shell am force-stop $P` and open the app normally.
    - `adb shell dumpsys gfxinfo $P reset`, then for 30 s: open the deck, scroll it, open and close the tray over
      it, open a tab and go back. Then `adb shell dumpsys gfxinfo $P | grep -E "Janky|percentile"`.
    - With the look off, the deck and backdrops are flat colours and the frosts solid. Report both sets of lines,
      then switch the look back on.
    - Then twice more with the look on and the lab's Blobs button at `Blobs 30 fps` and `Blobs 20 fps` (it logs
      `PAGELAB look blobs at N fps` and lasts across launches; set it back to `Blobs every frame` afterwards).
      The Compose app draws its blobs every frame and blurs each bar frost every frame too, so "every frame" is
      parity; the capped runs tell whether a cap is worth its look. Also, from the look-on run, the idle deck:
      `adb shell dumpsys gfxinfo $P reset`, leave the deck untouched for 10 s, then the same grep.
    - From sync16 the backdrop draws its mesh and blobs into a small image (an eighth each way, 135 x 300 on a
      1080 x 2400 phone) and scales it up, with the grain a static layer over it. The deck's draw line ends
      `backdrop drawn as a small image scaled up (scene 135x300)`. While it holds still under a scroll the GPU
      replays one opaque scaled bitmap and the grain texture, not the gradients. The lab's `Backdrop:` button
      cycles `small image` (the default), `small, no grain` (the grain's share), `full size` (sync15's drawing,
      as Compose draws it) and `flat colour` (a flat fill repainted at the blobs' pace, so the cards and the bar
      above are recomposited exactly as often while the backdrop itself costs nothing). Force-stop after each
      switch. On both phones, with the look on and paced, on the idle deck, once per mode:
      `adb shell dumpsys gfxinfo $P reset`, 10 s untouched, then
      `adb shell dumpsys gfxinfo $P | grep -E "Total frames|Janky|50th|90th|gpu|Slow issue"`. The target on the F4
      is a 50th percentile under 8.3 ms with `small image`. Then, per mode, the deck scroll (`sched-scroll.txt`, or
      the Deck speed script's step 2) with the full look forced, against look off: sync15's M3 scrolled at 77 to
      81% janky with the full look against 29 to 47% off, with nothing of the look redrawing, so the held
      backdrop's replay was the cost; `small image` should bring it near look off. `flat colour` against `small image` gives the
      backdrop's own cost, and `flat colour` alone what recompositing the rest costs. If `flat colour` is itself
      near 8 ms, report it: the cards then need to be held on layers while the deck rests. Also run the FRAMES
      broadcast on the idle deck in each mode: the look views should be `DeckBackdropView` at the paced rate and
      each bar `FrostView` far less often, since a tinted frost redraws only when its colour changes.
    - When the Compose app is installed (before an upgrade run), do the look-on run on its deck too, the same
      30 s, and the idle 10 s, and take a light-mode deck screenshot in the same profile colour: both apps' blobs
      come from the same `ProfileLook.deckBlobs` and `DeckBackdropStyle` numbers (light blobs at 0.86 to 0.9
      lightness, 0.85 opacity), so the two screenshots should match.
    - From sync12 the blobs are paced by default: the deck redraws each time the fastest blob has moved 1% of its
      radius (about 25 fps on a 1080x2400 deck), and the frosts re-blur only then, each at a quarter to an eighth
      of its size. The Blobs button cycles `Blobs paced`, `Blobs every frame` (Compose's rate), `Blobs 30 fps`,
      `Blobs 20 fps`. Measure look off, paced, and every frame; the budget is paced within 2 ms of look off at the
      median.
    - From sync14 the deck bar's frosts, which sit over nothing but the backdrop, are fills tinted from the
      backdrop's colours under them, with no blur layer: the bar's colour follows the blobs, but the blobs are
      not seen through it. Logcat has, at each deck build and for each frost, `PAGELAB look frost … path=… (why);
      source deck: …`, which says what the frost found in its source. For the bar it should read `path=tinted
      … source deck: only the deck backdrop shows: N view(s) under it hidden by it, M over it that draw
      nothing`. When it reads anything else, report the line: it names the view that kept the blur (sync14's
      bar stayed `path=live` because an empty view sat beside the backdrop, which sync15 ignores). The Memory
      line says
      `… holding a blur layer (3 tinted from the backdrop)` and the DECK source no longer recording. The lab's
      `Bar frosts: tinted fill` / `Bar frosts: blur` button brings back the old blur to compare (it lasts across
      launches; set it back to tinted afterwards). On the M3, the idle deck with the look on, paced, once each
      way: `adb shell dumpsys gfxinfo $P reset`, 10 s untouched, then
      `adb shell dumpsys gfxinfo $P | grep -E "Total frames|Janky|50th|90th|Slow issue"`. Report both, and a
      deck screenshot each way in the same profile colour.
39. **Keyboard target:** right after a fresh launch (`adb shell am force-stop $P` first), open the tray. Logcat has
    `PAGELAB keyboard will change 0.0 -> N dp in M ms` as the keyboard starts to rise, then
    `PAGELAB keyboard did change to N dp` with the same N, and the tray rises with the keyboard on that first open
    too. Close the tray, switch to a keyboard of another height (emoji panel or a different keyboard app), and
    open it again: the will-change line already has the new height.
40. **Connect in two steps**: pick the sync folder (Choose Folder… under step 2; its name then shows there), then enter a
    phrase with one wrong word: connecting starts by itself and fails with the phrase's message, and the folder's
    name stays. Fix the word: it connects again by itself, no folder picker opens, and sync connects. Then Stop Syncing, pick a folder and leave without connecting; pick another folder and connect with
    it. `adb shell dumpsys activity uri-permissions | grep -i ardia` (or the Files app's access list) shows only the
    connected folder's grant, not the one left unused.
41. **Launch arguments** (lab build): run the Compose app's capture commands from `docs/android.md` against the Expo
    app, for example
    `adb shell am start -S -n $P/.MainActivity --ez ArdiaDemo true --es BrowseQuery otters`,
    `… --ez ArdiaDemo true --ez BrowseDeck true`, `… --ez ArdiaDemo true --es ArdiaOpenSheet settings` and
    `… --ez ArdiaOnboarding true`. Each does what it does in the Compose app, and with `ArdiaDemo` the sync view
    shows the demo Macs, not the real ones. Lab builds log `PAGELAB launch arguments {…}` once per launch
    with what the app was given. A store build ignores every one of them.
42. **Inline completion** (the tray on Android, and the lab's Completion panel). Do it first in the app's real tray
    (open it from the deck or a page), then in the lab:
    - In the tray, type `goo`: `gle.com` shows highlighted after the caret. Press Enter (the keyboard's Go): the tab
      opens google.com. Open the tray again, type `goo`, press Backspace once: only `gle.com` goes, `goo` stays,
      and typing `g` brings the highlight back.
    - Type `goo`: `gle.com` appears after the caret, highlighted, and the caret stays after `goo`.
    - Type `g`: the highlight shrinks to `le.com` with no flicker. Type `x`: the highlight goes and `googx` stays.
    - Backspace with a highlight showing removes only the highlight, then typing brings offers back.
    - Tap inside the text or select a word: the highlighted part becomes ordinary text.
    - Go submits the whole `google.com` (`PAGELAB completion submit "google.com" via keyboard action 2`, in the
      tray as in the lab). Leaving the field drops the highlight. A hardware Enter logs `via enter key`; if the
      keyboard also turns it into its Go action, the second one logs `submit ignored … the same press already
      submitted` and only one tab opens.
    - With a Chinese or Japanese keyboard, no highlight shows while composing.
    - Speed: tap Focus, `adb shell dumpsys gfxinfo $P reset`, then
      `adb shell input text googleandsomemoretextthatgoesonandonforsixtyfivecharactersintotal12` (65 keys) and
      `adb shell dumpsys gfxinfo $P | grep -E "Janky|50th|90th"`. The 50th percentile stays at or under the earlier
      runs' 13 ms on the same phone; report the three lines.
    - The same speed run in the real tray: open the tray with an empty field, then the same reset, `input text` and
      `gfxinfo` lines. The suggestions under the field update as you type, so report these three lines apart from
      the lab's.
43. **Deck with TalkBack**: with TalkBack on and eight tabs open, put
    the focus on a card and use TalkBack's scroll actions (the actions menu, or a two-finger swipe). The deck moves one
    card each way, as Compose's page left and right do, and at either end the action that can't move is not offered.
44. **Onboarding survives a recreated activity**: turn on
    Developer options › Don't keep activities, start onboarding on a fresh install, go to its third step, press
    Home, then come back from Recents. Onboarding reopens on the third step, not the first. Turn the option off
    afterwards.
45. **TalkBack behind Spaces, the Archive and Settings**: with TalkBack on, open the deck, then Spaces. Swipe
    right through every element to the end, then left back to the start: TalkBack reads only the sheet, never the
    deck's three buttons (Spaces, New Tab, the menu) or a card. Run the dump from step 23 with the sheet open: no
    deck button between `begin` and `end`. Close it, then do the same with the Archive and with Settings. Then close
    the sheet: the deck's buttons are read again. Report any sheet where a deck element is read, with its dump.
46. **Closing tabs from the deck** (sync10 crashed here): with nine tabs open, close ten tabs one at a time by
    flicking a card up or sideways, opening new tabs to keep a few, then ten more with the card's long-press menu
    (Close Tab). Each close plays the poof and the deck closes the gap; nothing freezes and `adb logcat -b crash`
    stays empty. Then close the last tab both ways: the app goes to the start screen. Report any crash with its
    `logcat -b crash` lines.
47. **The tray's blank frame** (the frame where the tray showed nothing over a page): with the look on, on a page
    (Wikipedia), open and close the tray ten times while recording the screen (`adb shell screenrecord
    /sdcard/tray.mp4`, stop with Ctrl-C after 30 s). Then the same with the look off (step 38's switch, force-stop
    between). For each run report whether any frame shows the tray blank (no frost, no rows) and the
    `PAGELAB look frost surfaces/sheet #N …` lines (the tray's frost) with their `path=` and reason. If it only happens with the look on,
    the frost is the cause; if both, it is not the look.
48. **The blank tab** (sync9's BBC tab): open bbc.com/news, wikipedia.org and github.com in three tabs, go to the
    deck and back into each twice. If a tab shows blank, pink or white, note which and report every
    `PAGELAB page view …` line from that moment (`shows its WebView at WxH`, `taken from another view`,
    `lost its WebView`, `size A -> B`) with a screenshot, and the same lines from a tab that drew.
49. **TalkBack for real.** A test tool that uses UiAutomation (uiautomator, agentos) keeps other accessibility
    services from running while it is attached, so touch exploration stays off. So:
    - Set the scene first, with the tool: open the deck with eight tabs, then Spaces.
    - Stop the tool, so nothing holds UiAutomation (`adb shell ps -A | grep -i -E "uiautomator|agentos"` should
      list nothing; stop its server or `adb shell am force-stop` its package).
    - Turn TalkBack on from adb:
      `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService`
      then `adb shell settings put secure accessibility_enabled 1`. MIUI may ship TalkBack as
      `com.google.android.marvin.talkback` or not at all; `adb shell pm list packages | grep -i talkback` says.
      In TalkBack's settings (Advanced › Developer settings) turn on Display speech output, so what it says
      shows on screen and `adb shell screencap` can capture it.
    - Move with TalkBack's keyboard shortcuts, which need no touch: next item
      `adb shell input keycombination KEYCODE_ALT_LEFT KEYCODE_DPAD_RIGHT`, previous item the same with
      `KEYCODE_DPAD_LEFT`, activate `adb shell input keycombination KEYCODE_ALT_LEFT KEYCODE_ENTER` (Android 13
      and later have `input keycombination`). After each move take `adb shell screencap -p /sdcard/tb-N.png`.
      Step through the whole sheet and past its end: report every item read, and whether any is a deck button
      (Spaces, New Tab, the menu) or a card.
    - Turn TalkBack off (`adb shell settings put secure enabled_accessibility_services ""`), reattach the tool,
      open the Archive, and repeat; then Settings; then no sheet, where the deck's buttons are read. If MIUI
      ignores the key combinations, say so: then only a hand on the phone can do this pass.
50. **Step 38 and the memory steps in their sync11 form**: run step 38 with every bullet (look off, look on with
    blobs every frame, at 30 fps and at 20 fps, the idle deck, and the Compose baseline if Compose is installed),
    then step 37 with the look on and off, the frost megabytes from each Memory line, and the Home plus
    `UI_HIDDEN` trim.
51. **The look's budget** (first switched on in sync13). Watch `adb logcat -s PAGELAB | grep "look budget"`.
    - Start clean: fresh install, or the lab's Look › Budget: reset (then force-stop). Look on, blobs paced.
    - Open the deck and leave it untouched for 4 s: after its first second the deck samples 2 s and logcat has
      `PAGELAB look budget over|within|inconclusive: verdict …, next build full|degraded, last N frames, median
      X ms against Y ms, Z% missed`. Touching the deck in those 3 s drops the sample (no line): leave it alone.
    - Close the deck (go to a page), open it again, leave it 4 s: a second line. One deck open gives at most one
      sample, so a third line needs a third open.
    - What the lab shows: Look › "Look budget: …" with the same verdict, the look the next build will get, the
      last sample's frames, median against deadline and share missed, and "lab forces …" when forced.
    - The look never changes in front of you: when the second `over` arrives the deck you are looking at keeps
      its blobs and frosts. Only after closing and opening the deck again (or force-stop and reopen) does it
      stand still with plain fills, and then the Memory line reads 0 recording, 0 holding a layer, 0 animating.
      Report if anything changed while the deck stayed open.
    - From sync16 the verdict is the look's duty cycle, not each frame against the display's deadline. The line
      reads `… last N frames, median X ms, busy B% of the time (limit 33%), one frame every P ms over 2.0 s,
      keeps up; against the display's deadline D ms (display H Hz), M% missed (not judged)`. A sample is over
      when the backdrop's frames add up to more than a third of the window, or when its median frame is longer
      than the pace it is drawn at (the phone cannot keep up).
    - Expected in sync16, with the backdrop drawn as a small image: the F4 is `within`. sync15 measured 28.9 ms
      frames, busy 56%, and it passes once a frame costs under about 16 ms. The M3 is the open question (sync14
      drew 48 to 69 ms frames). If it measures `over` twice it degrades, which is the rule working. Report
      both phones' lines, with the busy share and the median, and the lab's text.
    - The lab's controls: Budget: force degraded (from the next build the look is still and solid), Budget: force
      full, Budget: measured (back to what was measured), Budget: reset (forget everything and measure again on
      the next deck open). Check each takes effect only after the deck is rebuilt.
    - System settings win: with Remove animations on (Settings › Accessibility), the deck stands still whatever
      the budget says, and no sample is taken (nothing moves to measure).
52. **An idle app draws nothing** (sync11's look-off deck drew 1825 frames in 30 s with nothing changing). With the
    deck open and untouched, run `adb shell am broadcast -a com.ardia.phone.FRAMES -p com.ardia.browser.android
    --ei seconds 5` and keep hands off for 5 s. Logcat (`-s PAGELAB`) has `PAGELAB idle frames: N frame(s) drawn in
    5.0 s, … draw pass(es), … layout pass(es), … with no view redrawn; look views redrawn: <view> xN, …; redrawn:
    <view> xN, … and K more`. The look views (backdrops, frosts, frost sources) are listed first and in full,
    then up to 16 of the deepest other views that were redrawn, and how often. Do it with the look off (expected: 0 frames, nothing redrawn), with the
    look on (expected: the deck backdrop at its paced rate, about 25 a second, and nothing else), and on a page
    left still. Report every line; any view other than the deck backdrop, or any layout passes, is the leak to
    chase.
53. **The look lets go when the app is hidden.** Look on, nine tabs, tap Memory (step 37) and note the look part
    (`… frost(s) holding a blur layer, about X MB …`). Press Home, then
    `adb shell am send-trim-memory com.ardia.browser.android HIDDEN` (this Android's name for UI_HIDDEN). Logcat
    has `PAGELAB memory trim received: level 20 (UI_HIDDEN); …; look released for the hidden app: N frost
    layer(s) …`; every trim the app receives now logs one such line, whatever its level, so a missing line means
    the app never got it. Come back and tap Memory: graphics should be near the look-off figure until the deck is
    shown again. Report the graphics figure after Home with the look on and off.
54. **Graphics memory after closing tabs (settled in sync14).** With the look off, graphics stays at about 88 to
    90 MB after closing eight of nine tabs, against 45 to 56 MB with the look on. sync14's F4 showed what it is:
    GPU memory 105 MB, of which about 100 MB purgeable. It is the renderer's own cache of textures it no longer
    needs, which Android takes back on its own: at UI_HIDDEN (Home), under memory pressure, or when the app
    goes to the background. No public API asks the renderer to trim while the app is in front, and sync14's
    one redraw after closes did not shrink it, so that redraw is gone from sync15. Nothing to run. Report it
    only if graphics after Home stays above about 30 MB, or `dumpsys gfxinfo $P` shows a large GPU total that
    is not purgeable.
55. **Deck scroll, look on against look off** (from sync14). Run the Deck speed script's step 2 (`## Deck speed`)
    four times on each phone, two with the look off and two with it on (paced, budget forced full on a phone
    that degraded). Force-stop between look switches. In each look-on run also:
    - start `adb shell am broadcast -a com.ardia.phone.FRAMES -p $P --ei seconds 5` just before the first swipe.
      During the scroll, `redrawn:` should list the cards and not `DeckBackdropView`, or only once or twice
      when the scroll starts and stops: the backdrop holds still while anything else draws;
    - from the `PAGELAB perf deck scroll` lines, check the look field reads `look drew backdrop 0, recorded 0,
      blurred 0, retinted 0` (sync13's older field read `1 3 1`);
    - the `look drew …` counts are what the look did during the window (its running totals at the end less those at
      the start). What each interaction should show, from sync20:
      - a deck scroll and a card open: all 0;
      - a deck open: `backdrop 1, recorded 0` (the backdrop's first frame on the new deck, with the look on or off),
        and 0 blurred and retinted beyond the bar's first fill;
      - a tray open over the deck with the look on: `blurred` about one per frame of the rise (sync17b: 27 to 30)
        and `recorded` a few (the tray's sheet frost blurs what's under it as it rises, which is the look working);
        with the look off, all 0.
      Anything beyond that is a bug: report the line with the step and the time;
      the `at end recording … holding … animating …` part after them is only its state when the window closed, so
      a short swipe in a 1.2 s window can show `animating 1` there without being a cost;
    - report, per run, the janky share, the 50th, 90th and 99th percentiles, and the slow issue-draw commands.
      Look on should now be within a point or two of look off. If it is not, the FRAMES line names what is still
      being redrawn.

56. **Site permissions ask Android first** (from sync18). On a fresh install, with no camera, microphone or location
    permission granted:
    - Open webcamtests.com and start the test. Android's own camera dialog comes first; the site's Allow dialog
      appears only after Android grants. Allow it: the camera picture shows.
    - Open a map and tap its "my location" button. Android's location dialog first; approximate location is
      enough for the site's dialog to follow.
    - Clear Ardia's permissions (Settings › Apps), open the camera test again and refuse in Android's dialog: no site
      dialog follows, and logcat has `PAGELAB page request camera refused by Android: the site's request ends
      without a dialog`.
    - A permission Android already holds goes straight to the site's dialog with no Android dialog.
57. **Pull to refresh** (from sync18). Pull a page down past the trigger and let go: the spinner is the Ardia blue
    (#6395FC, #4A77D4 in dark), the pull holds at 56 dp while the page reloads and springs back with a slight
    overshoot when it is done. A short pull that doesn't reach the trigger springs back the same way. On a page with
    no background colour of its own, swipe back from the edge: what shows behind is the profile's surface colour,
    not plain white or black.
58. **The widgets take the Color setting** (from sync19b). With the Search and Your Mac's Tabs widgets on the home
    screen, set Settings › Color to green: both widgets turn green within a few seconds; set it back to the
    profile's colour: they follow. Force-stop Ardia and switch the phone between light and dark: they keep the
    chosen colour.
59. **The pager rounds pages to the display's corner** (from sync18). On Android 12 or later, swipe slowly between
    tabs on the bar: the moving page's corners match the screen's own rounded corners. On an older phone they stay
    at 55. Report the phone and whether the corners line up.
60. **Share sheet** (from sync19b).
    - Signed in (sync connected to the Mac): in Chrome, open a page, then Share › Ardia. A sheet rises over Chrome
      with "Open in Ardia" and "Send to Your Mac" ("Your Devices" when another phone receives tabs). Tap Send to
      Your Mac: "Sent to …" shows and the sheet closes itself after about 1.4 s, Chrome still in front; the tab
      arrives on the Mac. Repeat with Ardia force-stopped first: the send still arrives (it waits up to 20 s for
      sync to load).
    - Share again and tap Open in Ardia: Ardia opens the page as a new tab.
    - Share plain text from a notes app: the sheet offers "Search in Ardia", which runs that search.
    - Signed out (sync off): sharing a page offers Open in Ardia and the sync hint, no Send.
    - Back or a tap outside closes the sheet; Chrome is untouched and Ardia doesn't appear in Recents.
61. **The tray follows predictive back** (from sync19b, Android 14 or later). Open the tray and swipe back slowly
    from the screen's edge: the tray moves down with the finger, up to 72 dp. Let go early: it springs back and
    stays open. Swipe all the way: it closes as Back did before. With the tray closed, Back works as before
    everywhere else (menus, dialogs, the Archive). Before Android 14, Back simply closes the tray.
62. **A cold share** (from sync20). Signed in, force-stop Ardia. In Chrome, open a page, then Share › Ardia › Send
    to Your Mac. "Sent to …" shows and the tab reaches the Mac although Ardia wasn't running. Share the same page
    again: the Mac gets one tab for each share, never two.
63. **A rotation in the middle of a send** (from sync20). Share › Ardia, tap Send to Your Mac and rotate the phone
    at once. The sheet comes back in the new orientation, and the Mac gets exactly one tab. Repeat with Ardia
    force-stopped first.
64. **Back with a menu or voice search over the tray** (from sync20). Open the tray, long-press a row so its menu
    opens, then press or swipe Back: the menu closes and the tray stays open; Back again closes the tray. A slow
    predictive-back swipe with the menu open doesn't drag the tray. The same with voice search open over the tray:
    Back closes voice search first.
65. **A camera request from a background tab** (from sync20). On a fresh install with no camera permission, open
    webcamtests.com in tab A and start the test, then switch to tab B before Android's dialog shows. No Android
    dialog while tab B is in front. Go back to tab A: Android's camera dialog comes up now, and the site's dialog
    follows once it is allowed. Close tab A while its request waits: nothing asks. Rotate while Android's dialog is
    up and answer it: the site's dialog still follows (or the request ends, if refused). The lab log has
    `PAGELAB page request camera from a page not on screen: Android is asked once the page shows`.
66. **A deck open right after a page paints** (from sync20). Load a page and open the deck the moment it paints.
    The card shows that page's picture at once, from memory, not an older one or a blank. The lab log then has
    `PAGELAB snapshot <id> landed in N ms: generation G`. Close and reopen the deck: the same picture, with no flash
    back to an older one.
67. **The budget line's two shares** (from sync20). After a fresh install or cleared data, open the deck and leave
    it idle for 4 s. The Look section's budget line gives two shares: work plus other main-thread work, and beside
    it the whole-frame share as judged through sync17b. Drag a card or open a sheet during the sample: the line
    says the sample was dropped, with the number of frames something other than the backdrop drew, or of frame
    reports lost, and nothing is stored. An idle sample must still come out conclusive. If it never does, report
    the line: the foreign-frame check is too eager.
68. **Back closes what is open, on every Android version** (from sync20b). With 3-button navigation, the ◁ key:
    - the page menu (⋯) open: ◁ closes the menu and the page stays;
    - Settings open: ◁ closes Settings, or goes back one screen from a sub-screen;
    - a confirm open (close all tabs in the deck, or clear history): ◁ closes it and nothing happens;
    - the tray open: ◁ closes it; with voice search over the tray, ◁ closes voice search first;
    - nothing open over the page and no page history: ◁ opens the deck, and ◁ on the deck reopens that tab, as
      Compose's does (BackOrder.next ends at the tab switcher; DeckState.back reopens the selected tab). Only on the
      start screen with no tab does ◁ send Ardia to the background. Reopen it from Recents and try the menu and
      Settings again: ◁ still closes them;
    - rotate with the page menu open, then ◁: the menu closes.
    With gesture navigation, the same with an edge swipe.
69. **Remove animations is followed while Ardia runs** (from sync20b). Open the deck: the blobs move. Without
    closing Ardia, turn on Settings › Accessibility › Remove animations (or Developer options › Animator duration
    scale › Animation off) and come back. The deck stands still at once, and the lab line reads `still (reduce
    motion…)`. Turn it off and come back: the blobs move again, with no relaunch. Open a sheet each time: it fades
    while the setting is on and springs while it is off. That half needs the screens' hook; until it lands, only the
    deck follows, and its line says `read natively`.
70. **The widgets take every change** (from sync20b). With both widgets on the home screen, change Settings › Color
    three times within a minute (Green, then Purple, then Neutral): the Search widget ends on Neutral within a few
    seconds and keeps it. Then Stop Syncing: Your Mac's Tabs shows its "turn on sync" message instead of the Mac's
    tabs within a few seconds, as the Compose app's does.
71. **One Android dialog for a site's location** (from the build after sync20b). On a fresh install, open
    openstreetmap.org and tap "Show my location". Android's location dialog comes first; choose Approximate and
    While using the app. The site's dialog follows; tap Allow. The map centres on you, and Android asks nothing more
    (no "change to precise" dialog).
72. **A fullscreen video turns with the phone** (from the build after sync20b). With auto-rotate on, play a video
    fullscreen and turn the phone: the video goes landscape and back. Exit fullscreen while landscape: Ardia goes
    back to portrait. With auto-rotate off, the video stays as the phone's rotation lock says.

#### R8 pass (sync19-r8 and later R8 builds)

`apps/phone/scripts/build-apk <name>` shrinks the release with R8 (`android.enableMinifyInReleaseBuilds`) since
sync20b; `--no-r8` builds the unshrunk control.
The keep rules are in `apps/phone/android/app/proguard-rules.pro`. R8's reports (`mapping.txt`, `usage.txt`,
`seeds.txt`, `configuration.txt`) land in `<name>-r8/` beside the APK in `/tmp/ardia-phone`.
`apps/phone/test/r8/check-names.py <r8 apk> <unshrunk apk>` checks that what Android and the JavaScript reach by
name survived. R8 renames the libraries' classes, so a crash's stack trace names classes like `a.b.c`: run
`~/Library/Android/sdk/cmdline-tools/latest/bin/retrace <name>-r8/mapping.txt <trace.txt>` (or paste the trace into
Android Studio's "Analyze Stack Trace" with the mapping) to read it with the real names. Report the trace and its
retraced form together.

Start the pass where R8 is most likely to have broken something, then run the whole checklist:
1. Sync: connect with the phrase, scan the sync code with the camera, send a tab, receive one, open Spaces
   (serialisation, CameraX and ML Kit).
2. Background sync and widgets: add both widgets, change Color, leave the app in the background and check a tab
   sent from the Mac arrives (WorkManager, Room, Glance).
3. The share sheet, signed in and out (step 60).
4. What the native modules pass as structured values: the deck's page pictures, alert, confirm, prompt,
   permission and file-chooser requests, downloads, typing with inline completion (Expo's reflection).
5. Gestures and animation: deck scroll, tray drag, pull to refresh, swipe back and forward, the tray's predictive
   back (Reanimated, worklets, gesture handler).
6. Voice search, and the camera or video capture from a page's file chooser.
7. Fullscreen video (media3).
8. The lab: the deck-parts, frames and memory broadcasts and the Look section's buttons.

## Upgrade from the Compose app on Android

Both apps are `com.ardia.browser.android`, so the Expo app installs over the Compose app and finds its files.
Nothing in the Compose app's data is changed or deleted, so installing the Compose app back still works.

- **The gate** (`UpgradeGate.kt`, 9cc21830b). An import is pending while any Compose source (`databases/browser.db`,
  `shared_prefs/ardia.browser.xml`, `ardia.blocking.xml`, `ardia.reader.xml`) exists and
  `no_backup/PhoneSync/legacy-import.json` doesn't hold a valid, versioned receipt. While it is pending:
  - no sync controller is made (`ERR_IMPORT_PENDING`);
  - the browsing source refuses every read with `LocalBrowsingNotReady`, never an empty list;
  - `SyncWorker` retries instead of succeeding;
  - the page module makes no blocking or site settings;
  - links are queued, then delivered once, in order, when the gate opens.
- **The reader** (`PhoneLegacy.kt`, `ArdiaPhoneLegacy`, d0c0b4a79).
  - It copies `browser.db` and its WAL to `no_backup/PhoneSync/LegacySnapshot` and opens only the copy, so
    committed rows still in the WAL are read.
  - It runs `quick_check`, needs `user_version` 1 and every Compose column, and reports anything else as
    `unusable` (`schema`, `corrupt`, `locked`, `io`), never as empty.
  - `readLegacy` returns every tab and Archive entry with its saved state, the most recently active tab as
    selected, and the 14 JS-owned preference keys. `readVisits(afterId, limit)` pages history by id.
  - `applyNativeSettings` copies `ardia.blocking` into `ardia-blocking` (the same keys), splits `browsing.sites`
    into the zoom, Night Shade and app-links maps and their defaults, and copies the thumbnails of regular tabs and Archive entries
    into `files/PageSnapshots`. The thumbnail must sit inside `cache/TabSnapshots` and be a real image.
  - `markImportedWith(receipt)` applies those settings, writes the marker last, opens the gate and starts one
    sync. Every step can run again after a kill.
- **The importer** (JavaScript, `state/legacy/importer.ts`, shared with iPhone). The app starts only when the import
  is done or there is nothing to import; until then nothing runs: no tabs, pages, sync or links.
  - No source: nothing to do. A source done as an import: start. Otherwise the store's own decisions come first,
    even when the source is unusable or can't be asked: a valid receipt (`legacy.receipt` in the preferences
    table, version 1) means only `applyNativeSettings()` and `markImported(receipt)` run, so a kill between the SQL commit and the native
    marker finishes on the next launch. A source without one: import. The old `legacy.importVersion` marker no
    longer skips anything; `skipped-existing` is ignored and `1` (the old iPhone importer) counts as a receipt.
  - The import merges: a tab whose id is already in the store, or a setting already set, is kept as it is; the
    rest is inserted. Tabs, saved states (Archive included), thumbnails (Archive included), settings, history and
    the receipt commit in one SQL transaction. History arrives through `readVisits` in pages of 5,000 inside it.
  - Android ids are kept exactly, because thumbnails are named after them; iPhone ids are lowercased with their
    states and the selected tab. The old app's selected tab is selected after the import, over any newer tab the
    store already had.
  - The transaction stays open across `readVisits`; nothing else may write meanwhile, so the app's lifecycle
    and back handlers wait for boot, and the importer stops (`failed reason=write`) if it finds the transaction
    gone after a page.
  - Every record is imported or counted under a reason (`notWeb`, `duplicate`, `malformed`, `present`, and for
    settings `unknownKey`, `badValue`, `empty`). The source's counts must match what it reads, and the store's
    rows and setting values must match what was written, or the transaction rolls back. The log line
    (`ardia-legacy imported …` or `ardia-legacy failed reason=…`) holds counts and reason codes only.
  - It refuses the in-memory store (a store from a newer version): `failed reason=memory`, nothing marked.
  - Any failure shows a screen in place of the app: Ardia couldn't bring over the tabs and settings, they are still
    on the phone, Try Again. After a second failure, and only where the native module has `startFresh()`, it
    also offers Start Without Them: native opens the gate first, then `legacy.startedFresh` is recorded (not a
    receipt), and the app starts; if either fails the screen stays. The old data is left alone so a later
    version can still bring it over. A source `done` with outcome `startedFresh` starts the same way, and a
    receipt still finishes its native steps over it. Links that arrive while the screen is up run once, in
    order, after the app starts; each link's action finishes before the next starts.
  - Start Without Them calls `legacyImport.startFresh()`. On Android (248b3f68a) it first copies the blocking,
    filter and per-site settings when their files can be read (each file on its own, defaults when not; no
    thumbnails, no rows, as the iPhone does), then writes the marker with outcome `startedFresh` and no receipt, opens the gate, delivers held links and starts sync once, and touches no Compose
    file; `source()` then answers `done` with `outcome: "startedFresh"` (an import gives `outcome: "imported"`). A
    later `markImported` still imports over it. The iPhone (52379113c) does the same: a version 2 marker in
    `Application Support/PhoneSync/legacy-imported.json` with outcome `startedFresh`, the sync hold released and one
    sync requested, the SwiftUI app's store untouched. The blocking, filter and browsing settings it copied into
    the page module's suite at launch stay.
  - Per-site settings (1b33e2c47): hosts with blockers off join Trusted Sites, and a host's Desktop Site applies
    when a page enters that host. The Compose app never writes either flag to disk (Desktop Site lives only in the
    page), so a real upgrader has none to bring; the code handles them if they are there.
- **Names that must survive.** A placed widget, a pinned shortcut, the tile, a share target pinned in Android's share
  sheet and a job WorkManager queued all name a class, so the Expo app keeps every component the Compose app exports
  under the same name. The Compose app's `.share.ShareActivity` is an activity-alias of `.share.PhoneShareActivity`,
  and the alias is the only share target, so Ardia shows once in the share sheet. `apps/phone/test/r8/check-upgrade.py
  <compose apk> <expo apk>` checks the pair:
  - every exported component's name, kind, export and intent actions, and its class (or an alias's target) in the R8
    dex;
  - the widgets' provider meta-data and the launcher shortcuts' targets;
  - SyncWorker under its name, and WorkManager's Room identity hashes;
  - every database, preferences and key name the legacy reader opens.
- **Signing.** Android installs an update only when both apps have the same signing key and the new versionCode is
  not lower. The Compose debug build is signed with the building machine's `~/.android/debug.keystore`. The Expo
  app signs with `apps/phone/android/app/debug.keystore`, so for an upgrade it is re-signed with the Compose key
  (`apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android`). The Expo app is versionCode 2, the
  Compose app 1.

#### A Mac for a phone without one

The phones are on corex; the Mac is a hidden Ardia for Mac on shiv. `apps/phone/scripts/phone-sync-mac.mjs` runs on
shiv (a hidden instance with its own data folder and a sync folder in its work folder), and
`apps/phone/scripts/phone-sync-relay.mjs` runs on corex, where it keeps that folder and the phone's
`Documents/Ardia Sync` the same over ssh and the phone's own adb. Each has `start`, `status`, `sync` and `stop`
(`--help` on either). On corex, per phone:

```sh
S=<serial>; R=/Users/shivam-mini/.t3/worktrees/ardia/t3-ffb1082e-c9e4c64b1897b325; W=/tmp/ardia-upgrade-mac-$S
mac() { ssh shiv "cd $R && node apps/phone/scripts/phone-sync-mac.mjs $* --work $W"; }
relay() { node ~/phone-sync-relay.mjs "$@" --serial $S; }
scp shiv:$R/apps/phone/scripts/phone-sync-relay.mjs ~/phone-sync-relay.mjs
mac check                          # refuses an app older than this checkout's native API, and says what to run
mac start                          # prints the folder and the Mac's own device id; the phrase stays in $W/phrase.txt
relay start --mac shiv:$W/folder   # checks the phone's folder with a probe file, then mirrors every 3 s
```

- **The Mac app must match the checkout.** `mac check`, and `mac start` before it launches anything, refuse a
  Debug app whose binary is older than `packages/shell/ios/AppModule.swift` (where the native API version lives),
  or Pods behind `Podfile.lock`. Its JavaScript would otherwise stop at once with "native API skew: this JS bundle
  needs native API N, but the app was built with M". They print the commands that bring it up to date:
  `scripts/agent/locked pod -- sh -c 'cd apps/browser/macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install'`
  when the Pods are behind, then the `build-app --as phone-sync-mac` line from `--help`. pod install can re-quote
  `MARKETING_VERSION` in `apps/browser/macos/Ardia.xcodeproj/project.pbxproj`. If `git diff` shows only that,
  write HEAD's copy back (`git show HEAD:<path> > <path>`), so it never reaches a commit.

- `mac status` (or `mac sync` to sync first) prints every device the Mac sees with its id, name and kind, each
  device's open tabs, and the Mac's own tabs. `mac send https://example.com/x` sends a tab to the phone.
- `relay status` shows the last pass and the latest copies and deletions; `relay sync` runs a pass now.
- Connect the phone (Compose or Expo app): Settings › Sync With Mac › Connect to Your Mac. Step 1, Enter Words:
  the app has one field for all 24 words. Put the cursor in it and run `relay type-phrase`: it reads the phrase
  over ssh and types it through adb's standard input, so it never appears in a command, its output or a
  transcript. MIUI refuses injected text (`INJECT_EVENTS`), and `relay type-phrase` says so. The MIUI method, used
  on the F4 for upgrade14: a short script on corex reads the phrase with `ssh shiv cat $W/phrase.txt` into a
  variable and hands it to the test tool's own set-text action on that field (agentos `set_text`), printing
  nothing, so the phrase never reaches the screen, the log or the transcript. Never print the phrase or pass it as an argument.
  No screen read, screenshot, recording or accessibility dump is taken from the moment the phrase is in the field
  until the app has left Step 1. Neither app hides it there: the Expo field shows the words as typed
  (`keyboardType` `visible-password`, no autocorrect, autofill or spell check), and so does the Compose one
  (`KeyboardType.Password`, which keeps it out of the keyboard's learning but has no visual transformation). Only a
  private tab sets the Recents and screenshot protection. A screen read of that page captures the words. Step 2, Choose
  Folder…: in the system picker open Documents › Ardia Sync, then Use This Folder and Allow.
- When done: `relay stop`, then `mac stop` (it quits the instance and deletes `$W`), then
  `adb -s $S shell 'rm -rf "/sdcard/Documents/Ardia Sync"'` (the inner quotes are for the phone's shell, which
  would otherwise split at the space).

Checked without a phone: the Mac side started with the AGENTS.md rules (a Debug build, never the installed app,
`open -g -n`, `ARDIA_BACKGROUND=1`, a throwaway data folder), turned sync on, printed its phrase and devices, and
stopped cleanly. The relay ran on corex against shiv's folder with a stand-in for adb: copies, an idle pass,
deletions both ways and the loop. On shiv, a second hidden instance joined through the relayed folder with the
phrase; the Mac listed its id and its tab, and a tab sent from the Mac arrived once. On a phone: the connected
upgrade passed on the F4 (upgrade12, 9f37754cf's relay): probe, copies both ways, the same device id through the
import and every held kill. A file that vanishes between `find` and `stat` is now skipped rather than failing the
pass.

#### Upgrade tester script

Use the Compose APK and the Expo upgrade APK built for this run (same key), named here `$COMPOSE_APK` and
`$EXPO_APK`. Watch `adb logcat -s ReactNativeJS:I ArdiaJS PAGELAB` throughout (the lab's own lines are all under
`PAGELAB`), and `adb logcat -b crash` for crashes.
`P=com.ardia.browser.android`. The lab is `adb shell am start -n $P/.MainActivity --ez com.ardia.phone.PAGE_LAB true`,
then Upgrade; opening the lab never runs the import, and while the import waits its page area stays blank ("no
state"). A launch intent reaches a process that is already running, so to get from the app to the lab (or back)
force-stop first.

The kills, the failure screen and Start Without Them each end an import, so the script is three passes, each from a
fresh Compose setup (steps 1 to 3): pass A (steps 4 to 10: the reader, the kills, the import, a relaunch, Compose
back), pass B (step 11: the failure screen, then an import) and pass C (step 12: Start Without Them).

1. **Start from the Compose app.** MIUI refuses a fresh `adb install` (`INSTALL_FAILED_USER_RESTRICTED`), so
   install `$COMPOSE_APK` through the phone's own installer. If Ardia is on the phone, remove it in the phone's
   settings first (an Expo build has another key). `adb install -r` works over adb for every later update.
2. **Set up the Compose app as a tester has it.** Finish onboarding, then:
   - Open at least eight tabs and open the deck so each gets a thumbnail.
   - Archive two tabs (closing a tab archives it), one of them after going three pages deep. The Compose app keeps
     back history and scroll position only for archived tabs, not for open ones.
   - Visit about 30 pages. The Compose app has no History screen; history shows in search results.
   - In Settings: the color, search engine, search suggestions (off), auto-open keyboard (off), the auto-archive
     interval and Open App Links In (App).
   - In Site Settings: Night Shade (Automatic), swipe navigation, collapse bottom bar; zoom on one site and Night
     Shade on another; blocking: cookie banners off, a trusted site, a line in My Filters, one list off.
   - The Reader's size, serif and theme.
   - Connect sync. With no Mac of the tester's own, start the Mac on shiv and the relay as in "A Mac for a phone
     without one" (`mac start`, `relay start`) and leave both running for the whole pass. In the Compose app, connect
     with that phrase and Documents › Ardia Sync. Within a minute `mac sync` lists a `phone` device with the phone's
     name and an id, and its open tabs; the Compose app's Sync page lists the Mac. Send one tab each way:
     `mac send https://example.com/before-upgrade` arrives on the phone once, and a page opened on the phone shows
     under the phone's tabs in `mac sync`.
   - Not carried, because the Compose app doesn't store it: per-site Desktop Site (shown in the page menu but never
     written to disk) and open-in-app per site (there is no such control).
   Passes B and C need only a few tabs, one archived tab, a trusted site and a My Filters line.
3. **Write down the state.** Do this before anything else:
   - Screenshot the deck, the Archive, search results for an old visit, every settings page you changed, and the
     Mac's device list (Settings › Sync on the Mac, with the phone's device id in its detail; with the helper, save
     the output of `mac sync`, which has the phone's id and its tabs).
   - Run `adb shell am force-stop $P`.
   - Run `adb shell "run-as $P sh -c 'sha256sum databases/* shared_prefs/ardia.*.xml cache/TabSnapshots/*'"`
     and save the output. (`run-as` works only on the Compose debug build; the Expo build can't be inspected so.)

Pass A

4. **Install the Expo app over it.** `adb install -r $EXPO_APK`. Don't open the app yet.
5. **Reader check.** Open the lab, tap Read source and Read everything (`grep "PAGELAB upgrade"`):
   - The source is `pending`, with the tab, Archive and visit counts from step 2.
   - `read` shows every tab and both Archive entries, `states` at least the archived one that went three pages
     deep, `thumbnails` one per card that had a picture (Archive entries included), and `selected` the tab that
     was open.
   - `preferences` lists the keys you changed, and `visits` matches the source's visit count.
   - The lab's page area stays blank with "no state": the page engine waits for the import. Force-stop.
6. **A kill at each durable step.** A lab build can hold the import for 20 s at a step, through
   `--es ArdiaImportPause <step>`. Do these three in order, each from a stopped app:
   - `adb shell am start -n $P/.MainActivity --es ArdiaImportPause afterReceipt`. When logcat says
     `PAGELAB upgrade paused at settingsStart`, send a link to the held app:
     `adb shell am start -a android.intent.action.VIEW -d https://example.com/held-a -n $P/.MainActivity`. It does
     not open; the import is still waiting. Then run `adb shell am force-stop $P`. The SQL receipt is written, and
     the native settings and the marker are not. The link was kept on disk, so it survives the kill: it must open
     in step 7, once. (Don't send the link from a stopped app: that launch runs the import with no pause.)
   - The same with `afterSettings`, killing at `paused at settingsDone`. This launch finds the receipt, so it only
     applies the native settings (no `ardia-legacy imported` line). Send no new link: `held-a` from the first
     kill must survive this one and the next.
   - The same with `beforeMarker`, killing at `paused at beforeMarker`, again with no new link.
   Report the `ardia-legacy` and `PAGELAB upgrade` lines from each. With the helper, run `mac sync` after each
   kill: still only the step-3 phone id (a held import never makes a second device).
7. **The import.** Open the app normally. The import finishes from the receipt, nothing is imported twice, and
   `example.com/held-a` opens once, after the deck. Then check every item against step 3:
   - The deck has every tab in the same order, the same tab is selected, and each card shows its thumbnail.
   - The Archive has both entries with their thumbnails, and restoring the one that went three pages deep goes Back
     through them.
   - All the visits are there (History in the app, and search finds old ones), with no visit twice.
   - Every setting you changed holds: the color, search engine and suggestions, auto-open keyboard, auto-archive,
     Open App Links In, Night Shade, swipe, bottom bar, the Reader's size, serif and theme, each site's zoom and
     Night Shade, cookie banners, the trusted site, My Filters and the list you turned off.
   - Onboarding doesn't show (it does when the Compose app's onboarding wasn't finished).
   - In the lab, Read source gives `done` with `outcome imported`.
8. **The device the Mac sees.** On the Mac, the phone appears once, under the same name and device id as in step 3.
   It is not a second, new device. A tab sent from the Mac arrives, and one sent from the phone reaches the Mac.
   With the helper, after the import:
   - `mac sync` lists the phone under the step-3 id and no other phone, with the phone's tabs.
   - `mac send https://example.com/after-upgrade` arrives on the phone once, by itself, within about 20 s, with
     the app in front and nothing tapped (sync cycles every 15 s in front; sync11 and earlier needed Sync Now).
     Note the seconds from `mac send` to the toast. Not twice, not again after a force-stop and relaunch.
   - A page opened on the phone (`https://example.com/opened-after-upgrade`) shows under the phone's tabs in the
     next `mac sync`.
   - Settings › Sync With Mac on the phone shows it connected to the Mac, with no folder picker and no phrase
     asked for.
   Report the `mac sync` output from step 3, after the import, and after step 9, and the `relay status` lines.
9. **Relaunch with no second import.** `adb shell am force-stop $P`, then open the app twice. Each time, the deck,
   the Archive and History have the same counts as step 7 (nothing doubled), no `ardia-legacy imported` line, and
   `example.com/held-a` does not open again. With the helper, after the second relaunch, `mac send
   https://example.com/after-relaunch`: it arrives once, by itself, within about 20 s, as in step 8.
9a. **One tab per typed address** (the double tab after sync9's upgrade). With sync connected, open the tray and
   type `example.com/typed-after-upgrade`, then tap Go; then type `example.com/ime-after-upgrade` and submit it
   with the test tool's ime_enter. For each, `adb logcat -s PAGELAB` must show, in order, one
   `PAGELAB completion submit #n "…" via …`, one `PAGELAB completion js received submit #n "…"` with the same
   n, and one `PAGELAB tab opened … origin typed`; the deck gains one tab, and the next `mac sync` lists the
   address once. If two tabs open, report every one of those lines: two native numbers mean the field emitted
   twice, two received lines with one number mean the event was delivered twice, and a second `tab opened`
   line names the path that opened it (`origin received-from-mac` is a tab coming back through sync).
10. **Install the Compose app back.** `adb install -r -d $COMPOSE_APK`. It opens with the tabs, Archive, visits and
    settings from step 2, as if the Expo app had never run. Run the `sha256sum` from step 3 again: every line
    matches.
    Going back to a lower versionCode works only when the installed app is debuggable or the phone runs a
    userdebug or eng build. The Expo upgrade APK is a release build (not debuggable), so on a user build
    (`adb shell getprop ro.build.type` says `user`) `adb install -r -d` fails with
    `INSTALL_FAILED_VERSION_DOWNGRADE`, and `run-as` fails for the same reason; the F4 is such a phone. There,
    skip this step and the step-3 hashes. The evidence that the Compose files are untouched is then indirect:
    the reader copies the Compose database and the thumbnails it needs into its own folder and opens only the
    copies, never the originals (its `PAGELAB upgrade` lines), and the hashes and the Compose-back check come from a phone where the downgrade works; report which
    phone was which. Removing the Expo app (`adb uninstall $P`) deletes the Compose data with it.

Pass B (after steps 1 to 3 again)

11. **Failure screen, then an import.** `adb install -r $EXPO_APK`. Open the lab, tap Make source unusable
    (`source reports unusable (io)`; no Compose file is touched), then force-stop and open the app normally.
    - The "Couldn’t Bring Over Your Tabs" screen shows in place of the deck, and logcat has
      `ardia-legacy failed reason=unusable_io`.
    - Send a link while the screen is up:
      `adb shell am start -a android.intent.action.VIEW -d https://example.com/held-b -n $P/.MainActivity`. It does
      not open.
    - Tap Try Again: the same screen, now with Start Without Them and its note under it. Don't tap it.
    - Force-stop, open the lab, tap Make source usable, force-stop, then open the app normally. The import runs,
      the deck appears, and `example.com/held-b` opens once (it was kept across the restart). Compose back as in
      step 10: every sha256 matches.

Pass C (after steps 1 to 3 again, with a trusted site and a My Filters line set in the Compose app)

12. **Start Without Them.** `adb install -r $EXPO_APK`. In the lab, Make source unusable; force-stop; open the app,
    send `https://example.com/held-c` as in step 11, Try Again, then tap Start Without Them.
    - The app starts with no imported tabs (at onboarding when there are none), logcat has the started-fresh line,
      and `example.com/held-c` opens once. The trusted site and the My Filters line are there (blocking, filter and
      per-site settings are kept when they can be read); search suggestions are back to their default, because app
      settings come only with an import. Sync's page in Settings shows the Mac (sync runs), and a link sent now
      opens at once.
    - In the lab, Read source gives `done` with `outcome startedFresh`. Make source usable, force-stop and open
      the app twice: it stays started fresh, with no failure screen and no import.
    - `adb install -r -d $COMPOSE_APK`: the Compose app still has its tabs and settings, and every sha256 matches.

## Deck speed

Every interaction in a lab build prints one line, `PAGELAB perf <interaction> <window>ms | js … | ui … | renders … | look …`:
- js and ui are the frames each thread produced in that window (count, median, 90th percentile, worst, and frames over 1.5 budgets at 60 Hz);
- renders counts React renders by component;
- look gives the native look's recording, held layers and animations.

The render thread and the GPU don't appear there, so every run pairs the lines with gfxinfo over the same steps. The windows start at a deck pan (1.2 s), the deck's open (0.9 s), a card's open (0.9 s) and the tray's open (0.8 s).

#### Deck speed tester script (lab build)

Run it once with the look off (lab › Look) and once with it on, at animator scale 1. `$P` is the package. Swipes are in pixels for a 1080-wide screen; scale them for others.

The tab count is part of the run. Deck speed depends on it: with up to 19 tabs every card stays mounted, and with more the deck mounts cards as it moves (sync19 ran 26 tabs against sync16's 9, and its deck scroll looked twice as slow for that reason alone). So:
- State the count before you start: 9 unless the brief says otherwise (26 for a large deck). Every tab must have a picture: open each site and wait until it has loaded, then launch with `--es ArdiaDeck "warm"` and wait until the `PAGELAB snapshot` lines stop.
- Check it before every measured step: each deck open logs `PAGELAB deck shown with N tabs, M private`. If N isn't the stated count, or M isn't 0, fix the tabs before measuring; tabs sent from a Mac or opened by an earlier check count too.
- Print it with every result: `tabs=N (checked HH:MM:SS from the deck line)` at the top of each gfxinfo and perf file, and the count in the report's table. Two runs with different counts aren't compared.

1. `adb logcat -c`, then `adb shell dumpsys gfxinfo $P reset`.
2. Deck scroll: open the deck. Five times, `adb shell input swipe 860 1300 220 1300 300`, then 1.5 s idle; then five times the other way, `adb shell input swipe 220 1300 860 1300 300`. Save `adb shell dumpsys gfxinfo $P > scroll-<look>.txt`.
3. Reset gfxinfo. Deck open: from a page, tap the Tabs button, wait 1.5 s, tap the focused card, wait 1.5 s. Repeat five times. Save gfxinfo as `open-<look>.txt`. The same loop gives both "deck open" and "card open" lines.
4. Reset gfxinfo. Tray open: from a page, tap +, wait 1.5 s, Back, wait 1.5 s. Repeat five times. Save gfxinfo as `tray-<look>.txt`.
5. `adb logcat -d -s PAGELAB | grep "PAGELAB perf" > perf-<look>.txt`.
6. Report from each gfxinfo file: janky frames %, 50th and 90th percentiles, GPU 50th percentile, "Number Slow UI thread" and "Number Slow issue draw commands". From the perf lines, the median js and ui p50 per interaction and the renders.

#### Timing opens and launches from a recording

Time a deck open, a card open, a flick or a cold start from a screen recording only with `apps/phone/test/phone-runs`'s
`rec.sh`, `vtool.py` and `opentimes.py` (the phone-runs README has the commands). They take every frame's time from
screenrecord's own per-frame stamps and every touch from the phone's input log. Recordings timed from the moment
screenrecord was started are off by however long its encoder took to deliver the first frame, 235 to 590 ms and
different on every recording (found on the M3 on 2026-11-16), so their times don't compare between recordings or
visits. **Open and launch timings measured on the M3 before 2026-11-16 are not comparable**: the testers' openana.py
used that clock, including the expo58b runs that read the upgrade as faster. The F4's runs used the frame stamps and
stand.

#### Against the Compose release (F4, 2026-11-15)

One session on the F4, medians, the Compose app's release build (OLD) against sync23 (React Native 0.81) and expo58b
(Expo 58). From `/tmp/ardia-phone-shots/expo58b-f4/table.txt`.

| Row | Compose release | sync23 | expo58b |
| --- | --- | --- | --- |
| Cold start, `am start -W` | 308 ms | 300 ms | 328 ms |
| Cold start to usable (the tray up) | 905 ms | 1,236 ms | 1,198 ms |
| Deck open, first shrinking frame | 156 ms | 450 ms | 272 ms |
| Deck open, settled | 443 ms | 762 ms | 583 ms |
| Card open, first moving frame | 93 ms | 128 ms | 132 ms |
| Card open, settled | 410 ms | 678 ms | 608 ms |
| Card open, longest frame gap | 17 ms | 113 ms | 87 ms |
| Deck scroll, nine tabs, janky | 7.9% | 3.0% | 3.3% |
| Deck scroll, 26 tabs, janky | 8.8% | 18.9% | 20.8% |
| Memory, nine tabs | 333 MB | 432 MB | 432 MB |
| Installed size | 26.2 MB | 73.5 MB | 52.6 MB |

Known gap in the opens, **the card open's tail**: in 6 to 11 of 15 card opens per build (the M3's bisect, expo58b and
expo58c alike), one more change lands 500 to 650 ms after the card starts moving, when the live page replaces the
card's picture. The other opens settle about 220 ms after they start moving. That second change is the F4's card open
settling at 608 ms against Compose's 410, and its 87 ms held frame against Compose's 17. The rest of the gaps, largest
first: the 26-tab deck scroll, the deck open's first frame (+116 ms), cold start to usable (+293 ms) and memory
(+99 MB with nine tabs).

#### Deck parts (lab build, from sync17)

To find what a deck frame costs, take the deck's parts away one at a time while the backdrop repaints at its
pace (lab › Look › Backdrop: flat colour, budget forced full), and measure each with the idle gfxinfo and
framestats. `adb shell am broadcast -a com.ardia.phone.DECK_PARTS -p $P --es part <part>` logs
`PAGELAB deck parts: …`: what it changed, then an inventory of the shown views (how many are drawn offscreen
every frame because they are partly transparent and overlap with no layer, listed by size and alpha; hardware
layers and their pixels; views with elevation; outline and overflow clips; image views and how many are
pictures; fade views; look views) and the parts applied so far. Parts accumulate until `restore`:
- `inventory`: the inventory only, nothing changed;
- `shadows`: elevation and translationZ set to 0;
- `clips`: clipToOutline off and overflow-hidden views set visible;
- `snapshots`: image views 100 dp and wider hidden (the page pictures, not favicons);
- `alpha`: the partly transparent views made opaque, so none is drawn offscreen;
- `layers`: the same views held on hardware layers instead (keeps their alpha);
- `bar`: the deck bar's plates hidden;
- `headers`: the card headers (fade views) hidden;
- `restore`: everything put back.
JavaScript re-renders can put a prop back, so apply a part on the settled deck and measure right away.

## The look's budget

The look (the deck's moving blobs and the frosts) must cost a phone no more than it can carry. A phone measures
it once and turns the look down if it can't; the system settings always come first.

- **What is measured.** The first time the deck is built after an install or an update, `useLookBudgetProbe`
  (called by the deck with whether it is idle) skips the deck's first second, then takes 2 s of the app's own
  frame times while the deck stays idle (no scroll, drag, sheet, menu, tray or card opening). Each frame counts
  what it cost (Android's `TOTAL_DURATION`, from its vsync to the GPU finishing it) against its own deadline
  (`DEADLINE`, the frame timeline's, about 1.4 refresh intervals on a 120 Hz panel), but only while that
  deadline is within 1.5 intervals of the display's refresh rate, read once at the sample's start and never
  slower than 60 Hz. A deadline the system stretched (a halved frame rate) is held to one interval, so a slow
  phone can't pass because the system lowered its rate. A paced deck that skips vsyncs is judged only by the
  frames it draws. An idle deck with
  the look off draws no frames at all, so every frame in the sample is the look's own. A sample that overlaps
  anything else is dropped, and one deck open gives at most one measurement.
- **The verdict.** A sample is over budget when the look keeps the phone busy more than a third of the time,
  or when its median frame's work is longer than the pace it was drawn at (it cannot keep up at all).
- **What busy counts** (from sync20). Each frame's work: FrameMetrics `TOTAL_DURATION` less
  `UNKNOWN_DELAY_DURATION`, which in `dumpsys gfxinfo … framestats` columns is `FrameCompleted − IntendedVsync`
  less `HandleInputStart − IntendedVsync`, so from the moment the UI thread starts the frame to the GPU
  finishing it. Plus all other work on the main thread during the window: every message the main Looper
  dispatches except Choreographer's frame message, timed through `Looper.setMessageLogging` (`MainThreadWork`).
  The wait left out is only the time between the vsync and the UI thread starting the frame. Our own work
  can't hide in it. A native tick, a posted runnable, a React Native mount or anything else the main thread
  runs is a message, so it is counted as main-thread work whether or not it delayed a frame. Work inside
  the frame, such as Reanimated's and Fabric's frame callbacks, is in the frame's work. JavaScript runs on its
  own thread and reaches the main thread only as one of those. What remains in the wait is the system's
  delivery of the vsync, which on the F4 at 120 Hz was 4 to 8 ms a frame (sync17b) and varied from window to
  window. The line also prints whole frames over the window, the share every run through sync17b was judged on
  (`… busy B% of the time (whole frames, as judged through sync17b: W%)`), so a run can be read against the
  F4's 19 to 30% and the M3's 29%. From sync21 the lab's line breaks the other main-thread work down: how many
  messages, the backdrop's ticks against the rest, and the three longest messages by their handler and callback
  (`… other main-thread work 241.7 ms in 412 message(s): backdrop ticks 3.2 ms, the rest 238.5 ms; longest …`).
  Our own callbacks are named whatever R8 does (`ardia deck tick`, `ardia deck scene hand-back`). Other messages
  keep their full class names, which on a shrunk build read like `j6.s what 3`; `retrace` with the build's
  `mapping.txt` gives the real ones.
- **How busy is formed** (from sync22). Busy = (Σ each frame's work + the main thread's other messages + the
  backdrop's scenes drawn on the worker thread) / the window. The worker's time is the look's work on another
  core and counts the same as the main thread's; the line prints it as `… scenes drawn off the main thread in N ms
  (counted)`.
- **How often a scene is drawn** (sync22, reworked in sync23). With the blobs paced (the default), the worker draws
  a scene every 400 ms and keeps one more drawn ahead, so the next scene is ready before the fade needs it. On each
  frame (every 75 ms, on a fixed timeline so the pace is what was asked) it blends the two scenes at the small
  picture's size, and the deck draws that one picture scaled up, as before the fade. If a scene is ever late, the
  fade holds at the scene it reached and goes on from there when the scene lands; it never jumps ahead. A blend
  halfway between two scenes 400 ms apart is 0.042/255 a channel from the true scene at that moment, less than one
  old 43 ms frame step changed it (0.047, SceneOffMainTest on this machine). The lab's fixed blob rates (`Blobs N
  fps`, `every frame`) keep one scene per frame, drawn on the worker, as the yardstick. The sample lasts 3 s, so a
  frame every 75 or 100 ms still gives the 20 frames a verdict needs, and the line counts the scenes and blends
  drawn in it.
  The verdict uses busy, against the same 33%. It decides nothing under 20 frames unless those few frames are already over.
  Why a duty cycle: an idle deck's paced frames, drawn between vsyncs while nothing else moves, make nothing
  stutter that a person can see. What they cost is battery and heat, and that is the share of time the GPU
  and CPU spend on them. The sum counts every frame, slow ones included, since heat is the total. The keep-up
  check uses the median, so one slow frame can't fail a phone. Each frame's own deadline, held to the
  display's refresh, is still reported but decides nothing. Two over-budget samples on separate deck opens
  degrade the phone; one good sample between them starts the agreement over.
- **What degraded means.** Frosts become their fills and the deck stands still, by the same paths Reduce
  Transparency and Reduce Motion take, which leave nothing behind (no recording, no blur layer, no redraws). Reduce
  Motion and Reduce Transparency always turn their half off whatever was measured; the measurement can only take
  the look away.
- **Never in front of the user.** A verdict is stored at once but each look view reads it when it is built, so it
  shows the next time the deck (or a sheet with a frost) is built, never mid-session.
- **A second chance.** A passing phone is measured again after an app update; a degraded one after an update or
  30 days, by showing it the full look for the next builds until two samples agree again.
- **Telemetry.** One enum, `look_mode` (`full`, `no_blur`, `no_motion`, `neither`, from `lookBudget.mode()`), on
  `app_launched`: the look this launch shows, system settings included. No frame time leaves the phone. The deck
  calls `useLookBudgetProbe` through `DeckLookProbe`, idle while the deck is settled and untouched with no sheet, menu,
  confirmation or tray, and passes the system's Reduce Motion and Reduce Transparency.
- **The lab.** Look shows the verdict, the next build's look and the last sample (frames, median against
  deadline, share missed) and can force full, force degraded, go back to measured, or reset. Lab builds log
  `PAGELAB look budget over|within|inconclusive: …` for each sample.

**What the Codex review of 15 November changed.**
- A sample has one owner. A new one cancels the old one, whose late timer touches nothing. The sampler chains onto
  any Printer already on the main Looper and puts it back after. Setup that throws cleans up and answers once. JS
  cancels a running sample when the probe stops. A sample that lost a frame report decides nothing (4e77b8375).
- A frame is the backdrop's own only when no other view asked for it. Every traversal walks the views the backdrop
  doesn't explain, meaning anything other than itself, the views it just put on layers, its frosts and their
  parents. Any of those that is dirty, or that moved, scrolled or changed alpha since the last traversal, makes
  the frame foreign. RenderThread-only animations such as ripples stay unseen (61b71906b).
- The ticks stop and the resting layers are released when the deck is hidden or its activity stops, the look is
  off, reduce motion, reduce transparency or a degraded budget stills it, or the hidden app releases the look, not
  only on detach (61b71906b).

Shared and per-phone parts:
- Shared, in TypeScript (`packages/phone/src/lookBudgetRules.ts`): judging a sample, the two-sample agreement,
  the verdict per version, the re-measure, the system settings, the telemetry enum and the probe's timing (skip,
  idle only, one per open). `lookBudget.ts` keeps the state and gives the hook and the lab their calls.
- Each phone supplies five calls on `ArdiaPhoneLook`, and makes its look views read the stored `apply`
  ("full" or "degraded") when they are built:
  - `sampleFrames(ms)`: resolves `{ totals, deadlines, refreshMs? }`, one entry per frame the app drew in that
    window, in milliseconds, and the display's refresh interval read at the start (Android:
    `Window.OnFrameMetricsAvailableListener`, `TOTAL_DURATION` against `DEADLINE`, or the refresh interval
    before Android 12, and `Display.getRefreshRate`; iPhone: a `CADisplayLink`'s frame times against its target
    time; without `refreshMs` each frame keeps its own deadline);
  - `lookBudget()`: `{ state, version, forced }`, the stored state as JSON text, the app's version (with the
    build commit, so a lab build counts as an update) and a lab force or null;
  - `setLookBudget(state)` stores the JSON;
  - `forceLookBudget("full" | "degraded" | null)`, lab builds only;
  - `cancelSampleFrames()` ends a running sample, which then resolves null. A sample also carries `foreignFrames`,
    `waits`, `tickMs`, `mainThreadMs` and `droppedReports` where the phone has them.
  Android has all of it (`LookBudget.kt`); the iPhone half is not built yet.

## Telemetry

Off until the user chooses, in Settings (Share anonymous usage stats, with What's Sent) or on onboarding's last step. The consent model is the Mac's: nothing is sent, queued or counted while sharing is off, turning it off drops the queue, the day's counts and any request in flight at once, and an install ID is made only the first time sharing is turned on. Unlike the Mac, the phone sends no `daily_active` ping while sharing is off.

The gate is one file, `apps/phone/src/lib/telemetryGate.ts` (`createGate`): every capture, count and send goes through `isSharing()` there, and `state/telemetry/telemetry.ts` makes the app's one instance on the preferences table (`telemetry.sharing`, `telemetry.installId`, `telemetry.daily`, none of which the old iPhone app's import can set). The schema is `lib/telemetrySchema.ts`: every field is a fixed value, an enum, a bounded count or duration, or a version or UUID pattern, and a record that fails it is never queued. The OTLP encoding is shared with the Mac through `packages/core/src/telemetryWire.ts`.

Events (service `ardia-phone`, `$lib` `ardia-phone-telemetry`, tags `app: phone` and `platform: android|ios` on every one):

| Event | Fields | When |
| --- | --- | --- |
| `sharing_turned_on` | `source` (settings, onboarding) | turning sharing on |
| `app_launched` | `legacy_import` (imported, started_fresh, none), `legacy_import_failures` (failed tries before the app opened), `look_mode` (full, no_blur, no_motion, neither: the look this launch shows, after the look's budget and the system's Reduce Motion and Reduce Transparency), `interface_style` (match_mac, glass, classic) and `color_scheme` (match_mac, system, light, dark): the redesign's Appearance choices | each launch with sharing on |
| `perf_launch` | `launch_ms`, `js_ms` | each launch, once the module gives the process start (`ArdiaPhoneSystem.processStartedAt()`, epoch ms) |
| `usage_counts` | `tabs_opened`, `searches`, `pins_to_mac`, `tabs_sent`, `page_processes_gone`, `links_given_up` (a link whose handling passed its 8 s deadline), `pages_reloaded_online` (a failed page reloaded when the phone came back online), `find_opened_system` and `find_opened_bar` (Find on Page opened in WebKit's own panel, or in the app's find bar), `spaces_swiped` (a swipe in Spaces or on the start page that changed the profile), `tray_hidden_rows_opened` (a tray row opened while it peeked or sat under the keyboard), `deck_pictures_late` (a deck opened from a page whose picture hadn't painted within 250 ms, so it shrank without waiting), `search_tabs_opened` (the deck's Search Tabs field focused, in the redesign), `spaces_picked` (a space picked from the start page's or the deck's switcher menu that changed the profile, in the redesign), `tabs_moved_to_space` (a tab moved to another space with the deck card menu's Move to Space, in the redesign), `pages_printed` (a page printed from the page menu's Print, counted when the print sheet opened, in the redesign), `site_permissions_revoked` (a site's camera, microphone or location access revoked from Site Settings, by swipe or by its dialog, on iPhone's Expo UI Settings), `tray_back_swiped` (a search tray closed with Android's predictive back swipe) | at most once a day, for the last UTC day the app was used before today, when anything was counted; private tabs are never counted |

On the dashboard they are kept out of every Mac section by source and lib (`PHONE_APP_SOURCE` in `apps/dashboard/src/server/sql.ts`).

Lab and development builds follow the Mac's rule for its development builds: they send when sharing is on, marked so the dashboard can leave them out. A lab build sends `$environment: "test"` (a Metro development build `"dev"`) and the resource `deployment.environment: "development"`; only a store build sends `"production"`. So an upload from a tester's lab build (as from sync20c) is labelled, not mixed with users'. `usageToday()` in `state/telemetry/telemetry.ts` gives a lab today's counts and whether sharing is on, without sending anything. To check counts on a phone: lab › Telemetry shows sharing, today's counts, native's pending counts (read without taking them) and native's consent with its generation, refreshes on Refresh and on each return to the app, and logs each reading as `PAGELAB telemetry day … sharing … | counts … | native pending … | native consent …`.

Every count and timing the phone can send, for the owner to read as one set and strike what he doesn't want (the approved starting point was "the smallest set", c6ebf08a8). A new count needs a question someone would act on; those near the line say so.

| Count | Added in | What it answers on the dashboard |
| --- | --- | --- |
| `tabs_opened` | c6ebf08a8 | Is the phone used for browsing at all, per active day |
| `searches` | c6ebf08a8 | How much of that browsing starts from the tray |
| `pins_to_mac` | c6ebf08a8 | Whether pinning to the Mac is used enough to keep |
| `tabs_sent` | c6ebf08a8 | Whether Send to my Mac is used enough to keep |
| `page_processes_gone` | c6ebf08a8 | How often the page engine dies under people; a rise after a release is a regression |
| `launch_ms`, `js_ms` (`perf_launch`) | c6ebf08a8 | Cold launch time, process start to first screen, and the JavaScript share of it |
| `legacy_import_failures` (`app_launched`) | 12a33bf03 | Whether the upgrade import fails in the field, and how many tries it takes |
| `look_mode` (`app_launched`) | 428c9a18d | How many phones the look's budget turns down, and to what; a share that grows after a release means the look got dearer |
| `links_given_up` | 16509434e | Whether a link's handling still hangs past 8 s; anything above zero is a bug to chase |
| `pages_reloaded_online` | b59e43a94 | Whether the reload on reconnect fires; near the line, worth striking once it is seen working |
| `find_opened_system`, `find_opened_bar` | Find on Page on WebKit's panel | How often Find on Page is used, and which find each phone gets: iPhone should count only system opens unless a tester switches the lab bar on |
| `spaces_swiped` | b9bb6e53e | Whether people find the swipe in Spaces or only use the switcher |
| `tray_hidden_rows_opened` | f5071fd5f | Whether rows past the keyboard are reached; near the line: zero would argue for a scrolling list, otherwise strike it |
| `deck_pictures_late` | the deck-entrance hold | Whether the leaving page's picture paints before the deck shrinks; a share of deck opens that grows after a release means a card may again open on a blank or placeholder face |

## What is left before the Expo app replaces both native apps

The bar is the Compose app on Android and the SwiftUI app on iPhone, screen by screen and setting by setting:
what each tap does, what is remembered, animations and their timing. Every item is one line: what it is, where it
lives in the native app, and its size (small: an hour or two; a day; more). Anything not yet seen working on a
phone is listed as unverified, even where the code is in. Audited 2026-11-15 at e1a9a4a7a.

Nothing is left in JavaScript against the old references. Android's largest items left are Send to Your Mac in
the share sheet and the tray's predictive back. The owner's open choices are in "Waiting on the owner"; what
nobody has seen working on a phone is the tester checklist below.
iPhone follows the SwiftUI app on main since the merge of main (8203d0b3c, 2026-11-15), and main's redesign of that app (a2cf29dac, d199b885c) moved the reference: what iPhone needs now is "The iPhone redesign" below. The audit above predates it.

### Decided by the owner (2026-11-15)

- One design on both phones: Android takes main's iPhone redesign too ("the same look on Android and iPhone … keep one design, not two"). Plan: flip Android to the redesign, run both suites and an Android phone pass, then delete the classic design and its tests in one commit, so there is never a third state. Where a platform has a native element it uses its own: on iPhone the system context menus with lift and blur and the action sheets, on Android their native equivalents, behind one JavaScript component; the drawn menus go once both are in. Android's native needs for the redesign (the page under the bar, `Glass` with Classic, Print, the Downloads list, the sync-cycle flag, the site permissions list and revoke) are with the Android agent.
- The sync demo gets tabs of its own, kept in memory, and never touches the tester's real tabs. Built: a launch with `ArdiaDemo`, `com.ardia.phone.SYNC_DEMO` or `-ArdiaSyncDemo` runs on an in-memory store seeded from `demoSeed` (eight open tabs with Sintra selected, four archived, seven visits), chosen in one place (`tabDatabase()`). Every tab change goes there: open, close, select, archive, page updates, pictures, scroll positions, received tabs, Move to Space, Close All, remembered page tones and history. It never touches the real tabs, saved states, archive or history, never deletes a real tab's picture or saved page, and doesn't apply the Mac's inbox, so sent tabs wait for the next real launch; usage counts aren't kept. At the next launch without the demo the real tabs are exactly as they were (`render/demoTabs.render.test.tsx` checks it byte for byte). Still shared with the real app in a sync-demo launch: settings, kept links, the telemetry consent, and the engine's website data (Clear Browsing Data in the demo clears it).
- Default Browser: Apple's web-browser entitlement is requested; the iPhone code stays ready to switch on when it is granted. On Android, Default Browser is offered by default (the role prompt), in onboarding and Settings.

- Find on Page on iPhone is WebKit's own find panel (`UIFindInteraction`), as main's SwiftUI app has, decided from the side-by-side screenshots in `/tmp/ardia-phone-shots/find-on-page/`. The app's own find bar stays for Android, and on iPhone behind the launch switch `-ArdiaAppFind YES` for comparison. `find_opened_system` and `find_opened_bar` count which one opens.

### Waiting on the owner

- Bookmarks in iPhone Spaces: kept (today), or dropped on iPhone as SwiftUI's Spaces has none.
- Reset › Connect Again: acknowledges the reset first on both phones (today), or goes straight on to connecting on iPhone as SwiftUI does.
- A question about iCloud on Android, which the owner is still clarifying; nothing to act on yet.

### For the owner to check by eye

- The deck's moving backdrop beside the old app's.

### Needs only JavaScript

Nothing left (2026-11-15).

### Needs native code on Android

Checked against the log on 2026-11-15. In, and used by the app: the fade view's Android half (4e12b293d); Start
Without Them (248b3f68a, with Compose's per-site settings in 1b33e2c47 and 191db304a); sync connect picking the
folder first (619ede040 on Android, `pickFolder` on iPhone); the launch arguments (4e6ea841a); the keyboard's
target height as its animation starts (5bf60a7fa); the onboarding step across a recreated activity (82d93e298).
Inline completion is in and waits on a phone (the checklist below). Since then, in and waiting on a phone (tester steps 56 to 61): site permissions asking Android first (610f0578d), pull to refresh on Compose's spring and accent with the profile's surface behind a swipe (397f87ce4, fbefd2967), the pager's display corner (9e3bc50f9, 080cb4000), the widgets' Color (9a1014d1f, 35f46a55d), the bar thumbnail taken on the way out (14bbb3d2f; the lag was the 700 ms settle delay), the share sheet with Send to Your Mac (d2ecc1416, its sends counted through 48ce2cb87) and the tray's predictive back (76f0509d3, a1da434a0). What is left:

- Release builds use R8 by default since sync20b (98684363b; `build-apk --no-r8` for the control): 90.1 to 57.6 MB with arm64-v8a and x86_64, both Expo builds; arm64-v8a only it is 38.9 MB (8af216ccb; "Size on Android" has the parts and the Compose release beside them). sync19-r8 passed the F4 with nothing failing on the shrunk build only, and the upgrade pair is built with it.
- The tray's predictive back swipe (step 61) is still unseen on a device. The F4 is on 3-button navigation, which MIUI won't change, and the M3 is Android 13 and quarantined. The Simlock Pixel 8 (Android 15) would not start: "Remote daemon is unavailable", then on the retry "Daemon request timed out". It needs a working Simlock Android daemon, or an Android 14+ phone with gesture navigation.

### The iPhone redesign

Since the merge of main, the reference for iPhone is the SwiftUI app on main, redesigned in a2cf29dac (bar, tabs, page menu, Settings, spaces) and d199b885c (motion). It was built as one design variant chosen in one place, the new design on iPhone and Compose's on Android; on 2026-11-15 the owner decided Android takes it too, so the variant goes once Android has passed on a phone ("Decided by the owner"). No scattered platform checks.

What main changed, by screen:
- Page bar: three glass pieces instead of the tinted strip. A 48 pt tab-stack circle, an address capsule (favicon or Not Secure, the host, a `···` page menu button) and a 48 pt plus, 8 pt apart, 12 pt from the sides, their bottom 21.5 pt above the edge. Only the pieces take touches; no press scale (`BarControls.swift`, `BrowseTokens.swift`).
- Page view: the page runs full screen under the bar, with `obscuredContentInsets` (top safe area, bottom 75) so fixed footers sit above the bar (33e8709be, ecdeaefc3). Collapse Bottom Bar shrinks the bar to a 30 pt host pill instead of hiding it; Find and the search panel hide it until the keyboard has gone (`BottomBarVisibility`, 53f7bece6).
- Page menu: word rows without icons, icon-only Reader, Copy Link and Share capsules, new Print, History, Bookmarks, Downloads and Site Settings rows, Open in Default Browser on its own (`ToolbarSheet.swift`, `Menu/`).
- Library: one History, Bookmarks and Downloads sheet. History merges this phone's visits with the current space's synced history and remembers deletions per space (`Library/`, `HistoryTimeline.swift`, 68440816a, 6cf89268b).
- Site permissions: camera, microphone and location answers are saved per site and listed and revocable in Site Settings (`SitePermissions.swift`). On the Expo iPhone they last one launch until that list exists (40c4bff61).
- Deck: header with the space switcher, an Incognito pill and a `···` menu (Archive, Spaces, New Incognito Tab, Reopen, Close All, Settings); bottom bar of a grid button, Search Tabs and plus; a grid view; a slim Archive capsule under the header; cards about 24 pt lower (`TabSwitcherView.swift`, `DeckChrome.swift`, `TabGridView.swift`, `TabsTokens.swift`, `TabsDeckGeometry.swift`).
- Start page: no logo; the space switcher at 0.44 of the height, the space's pinned tiles (4 a row, icon only) and page dots; a sideways swipe changes space. In light mode a themed backdrop gets a 34% white veil (`SearchHomeView.swift`, `PinnedTiles.swift`, `ProfileBackdrop.themeVeil`).
- Tray: a floating glass panel, 8 pt in from the sides and above the keyboard, radius 26; a submitted search lifts it 120 pt and fades it (`SearchTrayHost.swift`).
- Spaces: tabs belong to one Mac space; the deck, the tab swipe and Switch to Tab show the current space's tabs, and the app takes its colour (`TabSpaces.swift`). The Spaces sheet gets the switcher and page dots.
- Settings: an Appearance page (colour, Glass or Classic, Light or Dark, each able to match the Mac through the synced `look`); row icons dropped (`AppearancePage.swift`, `InterfaceStyle.swift`, `SyncedLook`).
- Onboarding: 28 pt bold titles, capsule buttons, rows and tips without icons, faster steps.
- Look and motion: every glass surface goes through `chromeSurface`, so Classic and Reduce Transparency work everywhere; toasts are glass and follow the appearance. Motion is two to three times faster with nothing bouncing (deck open 190 ms, card open spring 0.18); the tab swipe settles over the space's colour.
- Not applicable: the iPhone Duo layouts; widgets, extensions, intents and Spotlight (already in step).

Against the old reference, everything was wired and re-checked on the simulator beside the SwiftUI app (2fbd950ca, dd36012eb): the deck bar on `Glass`, `FadeView`, the system Paste, Default Browser, Open in Background, VoiceOver names, Clear Browsing Data by range, the card handover.

The work, most visible first. JS is the screens agent's, native the iPhone agent's. Native wrappers land first, each with a fallback, and the screens agent is told their shape.
1. Page bar redesign: JS, a day; Classic through `Glass` is native (item 7). In (0043d844e); on the simulator beside main its pieces sit within a pixel of SwiftUI's, but its glass is forced dark in dark mode and private tabs where main's follows the page's tone, and its `···` and + glyphs are about 25-35% small.
2. The page under the bar: native `PageView` inset prop, then JS lays the page full screen. Half a day; ships with item 1. Native in (`obscuredInsets`, `pageObscuresInsets()`, 86b1d53bc); JS in (ccf4e02da).
3. Search as a floating glass panel: JS, half a day.
4. Start page (switcher, tiles, dots, no logo): JS, a day. Built as the redesign's `StartPage` and `StartSpaces` with `startLayout`, `startInk` and `startMotion` read from main's `TabsTokens.swift`, `SearchHomeView.swift`, `PinnedTiles.swift` and `SpaceSwitcher.swift`; render tests in both designs. Its moving parts wait for the simulator (below).
5. Deck header and bar, Search Tabs, the new geometry: JS, a day. Built: `DeckHeader` (switcher, Incognito pill, `···` menu), `DeckBottomBar` (grid button, Search Tabs, plus), the Archive capsule and cards 24 pt lower, with `deckChromeLayout` and `deckChromeMotion` read from main's `TabsTokens`, `DeckChrome`, `TabDeckBar`, `ArchiveIntervalCard` and `TabsDeckGeometry`. Search Tabs filters the deck in place, as main's does. The grid button waits for item 12.
6. Spaces filtering, switching, Move to Space: JS only, a day (the sync module already carries every field). Built from main's `TabSpaces.swift`, `TabStore.swift`, `TabSwitcherView.showNewSpace` and `DeckChrome.swift`: in the redesign the deck, the tab swipe and Switch to Tab show the current space's tabs (a tab with no space, or a deleted one, belongs to the default space; private tabs show in every space); Close All closes this space's; switching selects that space's latest tab or the start page; the deck card menu has Move to Space. Android keeps Compose's behaviour (Compose has neither). Left for later: the Spaces sheet's switcher and dots (item 14), exporting only the current space, history by space (Library).
7. Appearance and Match My Mac: native bridges `look` from sync and gives `Glass` Classic and Reduce Transparency; JS adds the page, the two preferences and applies them to every glass surface. A day and a half. Native in: `SyncedView.look` (d2ce70978), `Glass` `surface`, `tinted` and `barShadow` (2f4e947fb). Built: the Appearance page (Color with Match My Mac, Interface Style, Light or Dark) from main's `AppearancePage.swift` and `InterfaceStyle.swift`, resolved in one place (`state/settings/appearance.ts`): `ChromeSurface` takes Glass or Classic from it (Reduce Transparency forces Classic), and the window's scheme is set through `Appearance.setColorScheme` so keyboards, sheets and pages follow, as main's `.preferredColorScheme` does. Android keeps Compose's Settings and never overrides the scheme.
8. Page menu redesign: JS, a day. Built from main's `ToolbarSheet.swift` (`PageMenuWords`): the navigation capsule, the icon-only Reader, Copy Link and Share capsules, Find, Send, Print (only where `pages.canPrint()`, running once the sheet has gone), the settings group, Site Settings into Settings, and Open in Default Browser on its own. History, Bookmarks and Downloads wait for the Library (item 11). Print: native `print(pageId)` plus a row, a few hours. Native in (`pages.print`, `pages.canPrint()`, f6a5c0613).
9. Bar collapse to a host pill, waiting for Find and the panel: JS, half a day.
10. Motion timings and flow: JS, a day.
11. Library sheet: JS, two to three days. Downloads list, open and delete: native, a day. Sync-cycle flag for history deletions: native, an hour. Native in: `downloads.files`, `preview`, `delete`, `deleteAll` (373ecfb03) and `sync.isCycleRunning()` (58995bf44).
12. Grid view: JS, a day.
13. Site Settings' saved permissions, listed and revocable: native and JS, half a day to a day; lifts the one-launch guard. Native in (`pages.sitePermissions`, `revokeSitePermission`, ae9767f78); the guard (`PhonePages.remembersSitePermissions`, false) is flipped when the JS list and revoke land.
14. Archive capsule, Spaces sheet, card details, toasts: JS, a day together.
15. Onboarding and Settings words, fonts and icons: JS, half a day.
16. The light-mode veil in the JS backdrop fallback and the status-bar ink choice: JS, an hour.
Telemetry the redesign adds: space switches, Search Tabs, the grid, the appearance choice.

#### Moving parts not yet seen in frames

Nothing here is done until it has been watched in the screens agent's own simulator frames beside main's SwiftUI app. Strike a line only with the frame sheet's path.
- Search panel: the lift and fade on Go and on a row (frozen on the simulator through 2026-11-15; the page's loading line, then on React Native's JavaScript-driven Animated, committed every frame and held Reanimated's commits; the fix waits for the simulator in `screens-depart8`).
- Start page: the tray-up fade and 0.96 scale, and the Reduce Motion fade without the scale; the bar fading out with it.
- Start page: the sideways space pager, and its jump when a space is picked from the switcher's menu; the page dots' colour change.
- Start page: the switcher's space menu, a folder tile's menu, a tile's Copy Link and Share menu, the plus menu.
- Start page: the tile press scale (instant, where main springs it with `Motion.press`); the glass of the tiles, bar and capsule; the light-mode veil in the drawn fallback; the bar glyph sizes (estimated from SF sizes 16 and 18).
- Deck: the `···`, space and Incognito pill menus; the pill appearing and leaving (fade, 0.9 scale spring); the Archive capsule's entrance and exit, its interval picker, and the cards' 26 pt spring down and back, easing to zero as a card opens.
- Spaces: the deck on a space switch (order reset, scroll to the second-last card, cards fading in, the archive card); the two-step card menu (Move to Space, then the space list); a moved card leaving and the gap closing; the swipe neighbours after a switch; the page changing to the new space's latest tab, or the start page for an empty space; the colour change; Switch to Tab on another space's tab (for a moment it may have no swipe neighbours until the sync event arrives).
- Appearance: the page's push and pop, the swatch ring; switching Glass and Classic live on open surfaces (the native `Glass` must take a `surface` change at runtime); switching Light and Dark live across windows, sheets, the keyboard, the status bar and pages' `prefers-color-scheme`, and back to System; Match My Mac following a new synced look; Reduce Transparency switched on while open; Night Shade Automatic following the app's scheme.
- Sheets with Remove animations on Android: Settings, Spaces, the archive and the small sheets come up and go at once, as Compose's do (the system scales Compose's durations to zero); with Reduce Motion on iPhone they still move on a 200 ms timing.
- Page menu: the sheet opening and closing on its white or black fill and its drag; the capsules' press scale and glass; row press highlights (instant, where main fades them over 0.2 s); the title feedback crossfade; the print sheet after the menu has gone; the Send to Device menu's place; Site Settings opening as the menu slides away; the accessibility-size layout.
- Tray field on the way out: from the first frame the tray leaves, its text shows as plain text with no caret (the native field is blurred and dropped), on both phones; check it doesn't jump or change size.
- Page load motion moved to the UI thread: the page's loading line (now a scaleX from the left edge where it animated its width, and fed from the store without renders) and the settings switch's knob and colour (now Reanimated). Seen on the F4 (`/tmp/ardia-phone-shots/loadline-proof/`): with a page loading, slow UI-thread frames 286 to 202 and janky 10.85% to 10.35%, the deck open's worst stall 108 to 92 ms; the card open keeps a 100 ms stall in both builds (another cause, the hand-over). Still to see on iPhone: the search panel's lift no longer frozen (`screens-depart9`).
- Deck: the bar rising above the keyboard and back; Search Tabs typing (the gap-close, the scroll to the last match, the keyboard hiding on a tap); the plus menu above the new bar; the header and bar fading with the deck's open and close; the glass on the new pieces and the grid glyph.

The owner's decisions on these (native menus on both phones, the entitlement requested) are in "Decided by the owner".

### Tester checklist for the next build

Everything nobody has yet seen working on a phone, in the order a tester meets it. Each line is what to do, then
what should happen. Lines marked **Android** or **iPhone** are for that phone only; the rest are for both. Note the
build's `PAGELAB build` line first, and for a line that fails, keep a screen recording and the time. Android's
own scripts stay as they are ("System entry points on Android", steps 1 to 55, and "Upgrade from the Compose app
on Android"); a line here points at their step where one covers it. The deck's four motions (card open, deck open
from a page, closing, a reloading tab) are not here: they are being matched to Compose frame by frame on the F4.
iPhone lines on screens main's redesign changes ("The iPhone redesign") are checked again once those land.

Already seen on a phone, so not here: closing tabs from the deck and the last tab with no crash, ANR or JS error
(40 closes on sync15); the Archive card and the + menu above their buttons, and Inactive Tabs shown once; no
missing card on long flings; Go with no completion closing the tray and keyboard; a drag down from the field or
the top edge leaving no keyboard and no dim; the tray's fourth row peeking and a slide under the keyboard opening
it; one tab per Go before and after a connected upgrade; a typed tab not coming back from the Mac; a sent tab
arriving by itself; an idle deck drawing no frames; flick and menu closes using the same poof; a deck opened from
a page with no title-and-host placeholder (sync15); the bar frosts taking the tinted path. On the iPhone
simulator, the list under "The iPhone redesign".

**1. Install and upgrade**
- [ ] **iPhone:** before updating the SwiftUI app, note a Trusted Site, a My Filters rule, one site's page zoom, Night Shade, the Open App Links In choice, a few tabs and one archived tab, with Sync connected; install the Expo build over it and open it. Expect: no onboarding; the same tabs, the archived one in the Archive; that site's page menu shows its zoom, Night Shade and blockers off; Settings › Sync still shows the Mac.
- [ ] **iPhone:** relaunch twice. Expect: nothing appears twice.
- [ ] **iPhone:** open the deck, then update the app once more and open it again. Expect: imported cards keep their pictures both times.
- [ ] **Android:** the upgrade script ("Upgrade from the Compose app on Android") if this build hasn't had it.

**2. Onboarding** (a fresh install, or a lab build launched with `ArdiaOnboarding`)
- [ ] Go forward and back through every step. Expect: each step slides 60 points with a fade both ways; leaving the welcome crossfades the backdrop; each step ticks and the last gives a success haptic; the keyboard goes down between steps.
- [ ] On the sync step. Expect: a Mac window with a QR code and a phone scanning it, not a symbol. Tap Connect to Your Mac: the connect screen slides up from the bottom; Cancel slides it down. Connect: the phone in the picture turns plum, its viewfinder shrinks away as a checkmark grows in, and the subtitle crossfades to "Connected."
- [ ] **Android:** on the welcome, tap Continue at once. Expect: the default-browser step still shows.
- [ ] **Android:** mid-onboarding, change the system font size so the activity is recreated (step 44). Expect: the same step comes back.
- [ ] **iPhone:** the default-browser step. Expect: it shows only when SwiftUI's would (offered, and not asked within 100 days); with the entitlement off, as in test builds, it never shows.
- [ ] At the largest text size. Expect: each step scrolls. With Reduce Motion on: the welcome fades instead of moving.

**3. Start page and the search tray**
- [ ] With no tabs and sync on. Expect: the start page's leading button is Synced Tabs; the logo fades and grows from 0.92 and the bar fades as the tray comes and goes.
- [ ] Open the tray. Expect: it comes up with the keyboard and sits on its top edge on every frame, with no gap or overlap (including over Android's navigation bar); with a hardware keyboard it lands after 450 ms; the dim fades in over 300 ms; with Reduce Motion it fades instead of moving. Close it: the keyboard goes and the tray follows it down.
- [ ] Drag the tray down from the field, the incognito caption or the empty area. Expect: the dim lightens; past 8 points the keyboard goes down while the tray holds still; a short slow drag springs back and the keyboard returns; a long drag or a flick closes it.
- [ ] Touch a row, slide along the rows and lift. Expect: the touched row lights at once, each row ticks as you pass it, and the last one opens on release with a confirm tick; the arrow on a query row refines; a 400 ms hold opens the row's menu; past 1.5x text size the list scrolls instead.
- [ ] Type "otter", then "!w otter", then "12*12". Expect: nine rows with an "otter" search kept second; "Search Wikipedia" for the bang; "= 144", which copies with a "Copied 144" toast on a tap and offers Copy on a long press. A Mac tab row shows a laptop and its host and opens as a synced tab.
- [ ] **Android:** inline completion (step 42). **iPhone:** type "goo". Expect: "gle.com" highlighted after the caret; Backspace removes only the highlight; Return opens google.com; with a Japanese or Chinese keyboard no highlight appears.
- [ ] Type a word with more suggestions than fit. Expect: the next row peeks faded at the keyboard's edge; slide from the first row down onto the keyboard and lift: the row laid out there opens, with a tick per row on the way. (The peek and the slide are seen on Android; the ticks, and the slide on an iPhone, are not.)
- [ ] Watch the tray as you type and clear. Expect: the caption, rows and empty tray crossfade; the Incognito label fades and grows from 0.9 at the toggle's edge; the field's text grows with the text size; past 1.5x rows wrap.
- [ ] **Android:** copy a link, open the tray; copy plain text, open it again. Expect: "Link You Copied", then "Text You Copied".
- [ ] Tap the incognito chip. Expect: what Compose's `IncognitoChip` does on Android; on iPhone a one-item menu, as SwiftUI shows.
- [ ] With TalkBack or VoiceOver on, move to a row's refine arrow. Expect: reachable, read as "Refine" and the row's title; each row's menu items are listed as actions; Close Search can be activated.
- [ ] Tap the mic in the tray, then Cancel. Expect: the keyboard goes down over the voice screen and comes back on the tray. **iPhone:** allow speech and the microphone and say "otters": the words appear as you speak and the search runs; say nothing: after a few seconds it says it didn't hear anything. Watch the voice screen: the transcript crossfades as words arrive, the logo has a soft shadow, on iPhone the waveform eases.
- [ ] Select text in another app and choose Search in Ardia, and run a web search into Ardia (Android steps 4 and 5). Expect: results open at once. Open the voice shortcut: the voice screen opens over the tray. Open a tab widget's link to an archived tab: it is restored; to a private tab: nothing happens. **iPhone:** share a page to Ardia from Safari: it opens in a new tab, as shared.

**4. A page**
- [ ] **iPhone:** on a page with history, drag right from the middle. Expect: the previous page slides in with a tick under your thumb as it commits; a short drag springs back with no tick; a drag on a sideways carousel scrolls it and doesn't go back. (Android: steps 21, 29 and 35.)
- [ ] **iPhone:** at the top of a page, pull down past the spinner. Expect: a light tick, the spinner turns, the page reloads.
- [ ] Scroll a long page. Expect: the bar collapses with Compose's `Motion.barCollapse` spring and travel on Android (on iPhone, main's host pill replaces this). On a page whose colour changes as it scrolls: the bar's colour follows within a quarter of a second.
- [ ] Open the page menu, then drag its sheet down. Expect: it follows the finger and the dim lightens; a short drag springs back; a long drag or a flick closes it; with Reduce Motion it fades.
- [ ] From the page menu: pin to the Mac, Find, Reader, Copy Link. Expect: bottom-bar buttons and a landed tab swipe give haptics; **iPhone:** pinning gives a success haptic and the title's message lasts 1 s and crossfades; the title moves under the buttons at accessibility sizes; Find opens 350 ms after the menu closes and the bar slides away under the find bar. A link's Copy Link says "Copied URL Without Trackers".
- [ ] Open Reader. Expect: text can be selected, a size change animates, and a lead image that isn't a web address is skipped.
- [ ] Open the page menu, Reader and a long-press menu in turn. Expect: the status-bar icons stay readable over each.
- [ ] Long-press a link. **iPhone:** the system menu shows Open in New Tab, Open in Background, Copy Link, Share… and Download Linked File; Open in Background leaves you on the page; Share isn't offered while a sheet is open. **Android:** the app's drawn menu.
- [ ] **iPhone:** turn on Desktop Site. Expect: the page reloads as desktop, as SwiftUI's `toggleDesktopSite` does.
- [ ] **iPhone:** allow, then refuse, a site's camera, microphone and location requests. Expect: Allow and Don't Allow reach the page; the answers last until the app is relaunched (saving them waits on Site Settings, "The iPhone redesign" item 13).
- [ ] **iPhone:** a file input. Expect: WebKit's own picker, and Take Photo works. **Android:** steps 13 and 14.
- [ ] **iPhone:** play a video full screen. Expect: it covers the bottom bar and hides the status bar and the home indicator.
- [ ] A site asks to send notifications; start a download. Expect: on Android the request and the download notification as Compose's `PageRequests.kt` show them.
- [ ] Turn on Airplane Mode and open a page; turn it off. Expect: the offline page with a Wi-Fi-off icon, then a reload by itself (Android: step 36).
- [ ] Load a page that fails, then Try Again. Expect: the failure view's icon, title and Try Again as Compose's `PageLoadFailure.kt`.
- [ ] With Android's touch feedback off, use the deck and the bar. Expect: no haptics. On: the deck ticks per card while scrolling, a flick-close taps, Close All's confirm presses. iPhone keeps its impacts.
- [ ] Scroll a long page, kill the app and relaunch; also leave it in the background until the page is discarded, then come back. Expect: the same tab at the same offset both times.

**5. The deck and the tab pager**
- [ ] Scroll a page, then open the deck at once. Expect: the card shows the page as it is now.
- [ ] Hold a card for 400 ms; drag one slowly upward; tap a card right after a scroll settles. Expect: the hold opens its menu without scrolling, the slow drag lifts the card, the tap opens the card under the finger.
- [ ] Press Back in the deck. Expect: the selected tab opens with the expand animation. The card menu lists Send to each device and Pin to Mac; a lifted card can't be tapped open; a deck of 40 tabs scrolls without stutter.
- [ ] Open the deck from the start page. Expect: cards fade in; the backdrop and bar fade with the open; pictures fade in; two pages of one site share a placeholder colour; cards have the native shadow; a tab sent from the Mac shows "From Your Mac" until opened; the archive card scales in. With Reduce Motion: cards close, open and settle without springs.
- [ ] Long-press the bottom bar's tab button. Expect: the recent-tabs menu with Compose's haptic.
- [ ] Swipe the bar between tabs, and flick again while it settles. Expect: the incoming card has an edge shadow; the second flick neither jumps nor switches twice; with Reduce Motion the pager settles without a spring.
- [ ] **iPhone:** with VoiceOver on, swipe up or down on a card. Expect: it moves between tabs; the Tabs button answers a double tap.
- [ ] **iPhone:** press the deck bar's three buttons. Expect: they light up and flex under the finger as SwiftUI's do; with Reduce Transparency on, they turn white with an edge.
- [ ] **iPhone:** the deck's animated backdrop, frosted controls and glass bar on a device, with Reduce Motion and Reduce Transparency switched on and off. Expect: each switches as SwiftUI's does.

**6. The Archive**
- [ ] Open the Archive with tabs archived over a week. Expect: headers read Today, Yesterday, a weekday within six days, then the date (the year only when it differs), pinned with a tinted background; rows show a plain favicon; restoring ticks; Delete All warns and is disabled when empty; a search with no results shows the magnifier; an empty Archive shows its tile even while searching; Android Back clears a search first; on iPhone a swipe reveals Delete rather than deleting.
- [ ] Leave a tab longer than the archive interval with the app open. Expect: it is archived within 15 minutes.

**7. Sync and Spaces**
- [ ] **iPhone:** leave the app for an hour with the Mac open, then open it. Expect: the Mac's tabs are current without waiting.
- [ ] Send a tab from the Mac. Expect: a toast names it for about two seconds on both phones, and tapping it opens the tab.
- [ ] Settings › Sync › Connect to Your Mac › Scan Code, at the Mac's code. Expect: the scanner covers the whole screen with four corner arms; "Not an Ardia sync code." fades in for a wrong code; Cancel and Android's Back stop the camera; the status bar reads. **iPhone:** the code is outlined when found, pinch zooms, and it connects without typing. (Android: steps 19 and 28.)
- [ ] Enter Words. Expect: it slides in from the right over the connect page; the counter and footer crossfade as you type; on iPhone the keyboard is ASCII and a drag on the list dismisses it. **iPhone:** copy the phrase on the Mac and tap Paste: the words fill in with no "Allow Paste" question; Add a List does the same with an address.
- [ ] Open Spaces with the Mac connected. Expect: pinned tabs show their symbols; what you open or expand is kept when you come back; new rows fade in; the header crossfades; at 1.5x text size tab icons grow, titles take three lines and tiles drop their titles; a long press offers its menu to TalkBack and VoiceOver. With sync off, the empty state opens Connect. **iPhone:** the banner icons are the system's.
- [ ] Open a Spaces row, then type its host in the tray. Expect: it is offered as a visit you typed (`AppModel.kt` `openRemote`).
- [ ] While Spaces is connecting, drag its sheet down. Expect: it doesn't close.
- [ ] Turn Match My Mac off while the Mac has a custom theme. Expect: the colour Compose's `choiceAfterMatchToggle` keeps.

**8. Settings**
- [ ] Toggle Site Settings and filter-list switches quickly. Expect: no switch snaps back for a moment.
- [ ] **iPhone:** Clear Browsing Data from Settings. Expect: the "Cleared" toast shows above the sheet. Sign in to a site, use the phone for a day, then clear Last Hour with Cookies and Site Data on: you are still signed in.
- [ ] **iPhone:** Restore Defaults and Remove List. Expect: today centred dialogs; action sheets once the native menus land ("Decided by the owner").
- [ ] **iPhone:** tap About's links and a filter list's link. Expect: they open where SwiftUI's `Link` opens them.
- [ ] **iPhone:** once the build carries the web-browser entitlement, Settings › Default Browser › Open Default Apps. Expect: the system's Default Apps page; choose Ardia and come back: the page says Ardia is your default browser.

**9. Toasts**
- [ ] Raise a toast, hold it, then drag or flick it down; raise the same one twice; raise one with the keyboard up. Expect: it slides up from slightly smaller and slides down as it leaves; a finger holds it; a drag or flick down dismisses it; a short drag springs back and it leaves 1.2 s later; the same toast doesn't replay; with the keyboard up it sits at the top; VoiceOver reads it; a tab from an iPhone shows a phone.

**10. Outside the app (iPhone; Android's are steps 1 to 18 and 31)**
- [ ] With a page open, look at the Mac's Dock. Expect: a Handoff icon offers the same page; private tabs never offer one.
- [ ] Say "Open Otter in Ardia" for an open tab; add Shortcuts' Open Tab action and run it. Expect: Ardia switches to the tab; the action lists your tabs with their sites.
- [ ] In Spotlight, type a word from an open tab's title and tap the result; do the same for an archived tab. Expect: Ardia opens that tab; the archived one comes back from the Archive.
- [ ] Touch and hold the app icon. Expect: Search, Voice Search and New Incognito Tab each open what they say.
- [ ] Add a Lock Screen widget and a Control Center control, and the search widget. Expect: each opens the right link; the search widget follows the profile colour and Match My Mac.

**11. Lab builds only**
- [ ] Launch with `ArdiaDemo`, then each `Browse…` and `Ardia…` argument in `docs/android.md` and `docs/ios.md` (Android: step 41). Expect: eight demo tabs with Sintra selected, nothing written to the real store, the demo Macs in Spaces; each argument does what it does in the native apps at the same delays (6 s browse delay, 600 ms sheet, 1.5 s toast, 3 s deck open, 1.2 s deck script start); `ArdiaDeck` steps play in order; the pager freeze and script hold and swipe as Compose's do.

Not audited at all: Compose's `SyncSetupContent` internals inside onboarding.

### Deliberately different

- Long press on links and images in a page: iPhone shows WebKit's system menu with Open in New Tab, Open in Background, Copy Link, Share… and Download Linked File, as the SwiftUI app does; Android shows the app's drawn menu from `page.longPress` (c317c5b8f).
- Voice screen status-bar icons: always light; Compose takes them from the light-mode tint although the screen is always dark (3a9ca2f10, `lib/statusInk.ts`).
- Pin to Mac from the page menu: Android keeps Compose's toast, iPhone answers in the menu's title as SwiftUI does (5023ecabd).
- Paste and Go: Android only; SwiftUI has no such row (`lib/platformCopy.ts` `offersPasteAndGo`).
- Wording: each phone keeps its native app's words through one copy table per platform (`lib/platformCopy.ts`, 5db9a2263).
- Settings, the Archive and Spaces share one drawn sheet on both phones, as Compose's `SheetHost` (3a9ca2f10); SwiftUI uses the system sheet.
- Menus are drawn by the app (`components/ui/Menu.tsx`) on both phones, not system menus, so they match across platforms.
- Backdrops: native look views where the module has them, CSS gradients elsewhere; no Skia (the owner's decision).
- The code scanner is the module's own view (`ScanView`); expo-camera and its ML Kit are gone (00b9064e9).
- A suggestion whose text is an address opens that address, so a row tap does what Enter does (87bc6e89f).
- A link that arrives during onboarding is held and only the last one runs afterwards (43753d1b5); both apps act at once.
- The deck bar sits 6 points above a three-button navigation bar instead of on it (2db78f033), placed from the screen the deck covers (22016d607); gesture navigation keeps Compose's numbers. The owner kept this on 2026-11-15: overlapping the system's buttons is worse.
- Find on Page is the app's own bar on Android; iPhone uses WebKit's find panel as SwiftUI does.
- Opt-in usage stats (Settings, What's Sent, onboarding's last step) exist only in the Expo app (c6ebf08a8, the owner's approval).
- Settings has no Appearance or Downloads rows because Compose has neither (f5d1ec9f2). On iPhone this is stale: main's SwiftUI has both ("The iPhone redesign", items 7 and 11).
- Toasts sit above the deck bar's measured top, not a fixed 64 dp, so they never cover + (87e9ed9e6).
- After a reload the failure screen stays until that load ends, so the WebView's own error page never shows (becf40624).
- Labs and the sync demo are gated by the build (`ARDIA_LAB`, `ARDIA_TEST_BUILD`), not by a debuggable build as in Compose (4f474ff95).
- The Sync page's inbox-problem notice exists only in the Expo app (d9b85412f).
- Licences are generated from the shipped code, not a hand-written list (aa44da003); the iPhone list's content is the gap above.
- The sync demo keeps its tabs in memory (the owner's decision, "Decided by the owner"); Reset › Connect Again acknowledging the reset first and Bookmarks in iPhone Spaces (253515009) are the owner's choices, in "Waiting on the owner".
- The tray's rows end at the last whole row and don't scroll at normal text sizes, so no partial row is drawn for a fade mask (992441306, 7287c72fd); both apps clip with a fade instead.
- Matches both apps, not a gap: a cold start opens on the start page, never on the last page, and with Auto-Open Keyboard on raises the launch tray there, with the start page's logo and bar faded out behind it. Compose and SwiftUI both start on `Surface.Search`/`.search` and raise the tray when the start page appears (`SearchHomeView.kt` `openTrayIfWanted`, `SearchHomeView.swift`'s `.task`); neither brings back the page after a kill or a long absence. Back then closes the tray onto the selected tab's page, as Compose's `cancelSearch` (M3 sync12 item 6, checked 2026-11-15).
- Matches Compose, not a gap: with the on-screen keyboard up, the first Back only drops the keyboard and the tray stays, with the start page's logo hidden behind it, because the keyboard takes that Back in both apps (F4 sync12, the owner's call on 2026-11-15).

## Build and run

```
scripts/agent/locked pod -- pnpm install             once, from the repo root
apps/phone/scripts/gradle-locked :app:assembleRelease   JS bundled in, app/build/outputs/apk/release/app-release.apk
apps/phone/scripts/gradle-locked :app:assembleDebug     loads JS from Metro
pnpm -C apps/phone dev                               Metro on :8091 (the Mac's Metro keeps :8081); adb reverse tcp:8091 tcp:8091
pnpm -C apps/phone typecheck
```

Needs JDK 17 and the Android SDK (`local.properties` or `ANDROID_HOME`). The first build compiles React Native's and
Expo's Gradle plugins and the C++ of every native module, about 15 minutes on a busy Mac; JS-only changes rebuild the
release APK in about 2.

### The lab switch

The page lab (`com.ardia.phone.PAGE_LAB`) and sync's demo mode (`com.ardia.phone.SYNC_DEMO`) exist only in lab
builds. `gradle-locked` makes them: it passes `-PardiaLab=true`, which `@ardia/phone-native` turns into
`BuildConfig.ARDIA_LAB` (checked before either launch extra is read), and sets `EXPO_PUBLIC_ARDIA_LAB=true`, which
`index.js` reads at bundle time, so a build without it has no lab JavaScript at all and never makes the demo
controller. Even in a lab build the demo is refused while real sync is set up. The app's Gradle file fails the build
when the property and the variable disagree, and Metro's cache is keyed on the variable.

A store build leaves both off:

```
ARDIA_LAB=0 apps/phone/scripts/gradle-locked :app:bundleRelease
```

To see the lab with Metro, start it with `EXPO_PUBLIC_ARDIA_LAB=true pnpm -C apps/phone dev` and run a debug
build from `gradle-locked`.

### Size on Android

What an arm64 phone downloads and installs. "Download" is every entry an arm64 phone gets, each deflated on its own
(zlib level 9), which is close to what the Play Store sends; a directly downloaded APK costs its file size. Store
builds (R8 on, lab off) against the Compose app's non-debuggable release (`ardia-compose-release.apk`, R8 and
resource shrinking).

| Build | File | Download | Installed |
| --- | --- | --- | --- |
| Expo 58 / React Native 0.88, arm64-v8a (7dd666526, without `@expo/ui`) | 41.0 MB | 15.6 MB | 41.0 MB |
| The same with `@expo/ui` 58.0.28 linked | 45.8 MB | 17.6 MB | 45.8 MB |
| Expo 54 / React Native 0.81, arm64-v8a (266764af8) | 38.9 MB | about 14 MB | 38.9 MB |
| Expo 54 with arm64-v8a and x86_64 (the release build until 8af216ccb) | 57.7 MB | | 57.7 MB |
| Compose release, arm64-v8a only (its x86_64 libraries taken out) | about 12.0 MB | 5.7 MB | about 12 MB |

An earlier version of this table gave the Expo 54 download as about 10.2 MB and both ABIs as about 14.5 MB: those
were wrong, since its own parts (6.1 + 5.7 + 1.7 MB deflated, plus resources) already come to about 14. The Expo
app bundle (`build-apk --bundle`, 25.4 MB with debug symbols) hands an arm64 phone the same native code and dex,
so its download is about the arm64 APK's.

By part, arm64-v8a only, file (deflated):

| Part | Expo 58 | Expo 54 | Compose |
| --- | --- | --- | --- |
| Native libraries | 22.7 MB (7.8) | 18.1 MB (6.1) | 4.7 MB (1.8) |
| Dex after R8 | 11.5 MB (4.8) | 14.7 MB (5.7) | 5.5 MB (2.8) |
| JS bundle (Hermes bytecode) | 4.5 MB (1.8) | 3.9 MB (1.7) | none |
| Resources and assets | 2.3 MB (0.9) | about 1.5 MB | about 1.3 MB |

The Expo build stores the native libraries, the dex and the bundle uncompressed, so Android maps them straight from
the APK: what the file costs is what the phone keeps.

Where Expo 58's 22.7 MB of native code goes: React Native 7.1 MB, Hermes V1 2.7 (`libhermesvm.so`, which the sync
runtime shares), expo-sqlite 1.7 (the app's database), Reanimated 1.7, Expo's modules core 1.6, worklets 1.3, the C++
runtime 1.3, the generated app modules 1.0, SVG 0.8 (the logo and the sync pictures), zstd 0.7 (`expo/fetch`'s
decompression, new in 58), Fresco's image transcoder 0.6, then JSI, Gesture Handler's codegen, Expo's modules v2 and
the rest. The page engine is the system WebView, so it costs nothing here; sync is Kotlin and sits in the dex.
From 54 to 58 the native code grew 4.6 MB (React Native 1.2, Hermes V1 0.6, zstd 0.7, Expo's two module layers 0.6,
Reanimated and worklets 0.7) and the dex shrank 3.2 MB, since AGP 9 runs R8 with its optimize preset.

`@expo/ui` adds no native code: 3.7 MB of dex (1.6 deflated) and 1.2 MB of resources (0.3 deflated), 4.8 MB on the
file and 2.0 MB on the download. Most of it is not Compose, which the app already ships for its widgets and share
sheet, but Material Components for Android (`com.google.android.material`) with the RecyclerView, ViewPager2,
CardView and CoordinatorLayout it pulls in.

Where the Expo 54 dex went, by the classes' original package: kotlin.reflect 1.1 MB (Expo's modules need it),
React Native 1.0, Compose UI, runtime and Glance 1.6 together (the widgets and the share sheet), CameraX 1.0 (only
the sync code scanner), our own code 0.5, Expo's Kotlin layer 0.5, then AndroidX, OkHttp, kotlinx and the rest.

On an arm64 phone the Expo app is between three and four times the Compose release: 41.0 MB against about 12 on
the file, 15.6 against 5.7 on the download, before `@expo/ui`. The difference is React Native itself: its
libraries, Hermes, Reanimated, worklets and Expo's modules come to about 18 MB of native code the Compose app doesn't
have, and the JS bundle adds 4.5 MB.

Nothing big can go without losing something:
- x86_64 runs only on emulators and a few Chromebooks, so release builds leave it out; `--abi arm64-v8a,x86_64`
  builds it for an x86_64 emulator. Nothing 32-bit is built, so a 32-bit-only phone can't install the app.
- There are no fonts, and no image or resource shipped twice (under 2 KB of duplicates).
- expo-sqlite, SVG, Reanimated, worklets and kotlin.reflect are in use.
- CameraX serves only the sync code scanner, which a release build hides; it stays for now.

Packaging (`apps/phone/scripts/build-apk`):

```
build-apk <name> --store --bundle               the Play Store's app bundle, <name>.aab, checked on <name>-universal.apk
build-apk <name> --store                        a direct-download APK, arm64-v8a only, libraries and dex stored
build-apk <name> --store --compress libs,dex    the same with libraries and dex compressed, about 16 MB to download
```

The same arm64-v8a store build packed four ways (8af216ccb): libraries and dex stored 38.9 MB, libraries compressed
26.8 MB, dex compressed 30.0 MB, both compressed 17.9 MB. The universal APK made from the AAB is 30.1 MB, because
bundletool compresses its dex.

`--compress` is not the default yet: the F4 compares cold start (to the first frame and, by logcat's "Fully drawn"
line, to the app's own UI) and the first deck open against the stored build, with each one's installed size. Every
R8 build has to pass `check-names.py`.

### Size on iPhone

What an iPhone downloads and installs, measured 2026-11-16 without uploading anything. Each app was archived for a
generic iOS device, Release, with code signing off: Expo 58 / React Native 0.88 at 773ee4ded, against main's SwiftUI
app. Nothing touched the Apple developer account. An unsigned archive can't be exported, so there is no Xcode
thinning report.

- **Installed:** the archived `.app`, arm64 only.
- **Download:** the payload zipped at level 9, close to an `.ipa`. App Store Connect's own report will be the real
  figure: the App Store encrypts the executables, which then compress less, and thins the asset catalog.
- **Simulator:** the simulator builds measure 86.4 and 46.4 MB, because they keep debug symbols and simulator-only
  code. Don't quote those for a phone.

| Build | Installed | Download (zip -9) |
| --- | --- | --- |
| Expo 58 before the strip (773ee4ded) | 60.0 MB | 26.3 MB |
| Expo 58 as it builds now, with the Release strip of React Native's prebuilt frameworks | 56.5 MB | 25.7 MB |
| main's SwiftUI app | 27.7 MB | 16.6 MB |
| Both, after the App Store drops the iPad copies of the app icon (estimate) | about 4.3 MB less each | about 4.3 MB less each |

By part, installed (deflated):

| Part | Expo 58 | SwiftUI |
| --- | --- | --- |
| App binary | 12.7 MB (4.7) | 5.9 MB (2.4) |
| React Native's frameworks: React 11.6, hermesvm 6.1, ReactNativeDependencies 1.2, ExpoModulesJSI 1.2 | 20.1 MB as shipped, 16.5 after the Release strip: React 10.1, hermesvm 4.2, ReactNativeDependencies 1.1, ExpoModulesJSI 1.2 | none |
| JS bundle (Hermes bytecode) | 5.4 MB (2.2) | none |
| The three extensions (Share, Open in Ardia, Widgets) | 11.2 MB (4.4) | 11.2 MB (4.4) |
| Asset catalog | 9.4 MB (9.3) | 9.5 MB (9.4) |
| ArdiaKit's resource bundles | 1.0 MB | 0.9 MB |

**Where the Expo binary's 11.5 MB of linked code goes** (from its link map):
- our native module with ArdiaKit linked in: 3.2 MB;
- Expo UI: 2.2;
- Expo's modules core: 1.3;
- expo-sqlite: 1.2;
- Reanimated: 1.0;
- SVG: 0.5;
- worklets: 0.4;
- expo-file-system: 0.4;
- then React Native's codegen, Gesture Handler, Expo's other modules and the linker's own.

The SwiftUI app's 5.9 MB binary is ArdiaKit plus its SwiftUI screens.

**The asset catalog is the largest part of both downloads, and it is the app icon.** The Icon Composer icon is stored
as 1024 px renditions (any, dark, tinted), each once for iPhone and once for iPad: 8.6 of its 9.4 MB. It barely
compresses. The App Store's thinning sends an iPhone only its own copies, about 4.3 MB less. Both apps carry the same
icon, so it doesn't change the difference between them.

**What could go without losing anything:**
1. **The debug map in React Native's prebuilt frameworks, now stripped in Release.**
   - Xcode strips what it builds, but these four come prebuilt and are copied in as they ship. React and Hermes
     carry a debug map: about 88,000 entries naming object files on the machine that built them, which nothing on a
     phone or in a crash report can use.
   - The "Strip prebuilt symbols" build phase runs `apps/phone/ios/strip-prebuilt-symbols.sh` after CocoaPods'
     "Embed Pods Frameworks", in Release only. It runs `strip -S`, then re-signs each framework when the build
     signs. That saves 3.6 MB installed and 0.6 MB of download.
   - Function names stay, local ones included: the same 40,160 symbols before and after. React Native's prebuilt
     frameworks ship no dSYMs (only ExpoModulesJSI has one), so these names are what makes their frames in a
     crash report readable. Proof on the stripped device archive: `atos` names a React and a Hermes local function
     from the stripped binaries. Our own code goes through the archive's dSYMs, which stay with the archive: the app
     binary's UUID matches `Ardia.app.dSYM`, and an address in it resolves to `SettingsShortcutsView.body.getter
     (SettingsUIModule.swift:148)`.
   - `strip -x -S` would save 5.5 MB more installed, but it removes the local function names, and with no dSYM for
     these frameworks nothing can restore them. lldb then shows `___lldb_unnamed_symbol…` for React and Hermes
     frames. Not worth 0.3 MB of download.
   - The stripped build passes `ios-update-launch-check`, onboards and loads a page.
2. **The app icon's iPad copies** are the App Store's to thin. Nothing to do in the build.
3. **Nothing else:**
   - Expo UI draws the Settings screens; expo-sqlite is the app's store; SVG draws the logo and the sync pictures;
     Reanimated and worklets carry the motion.
   - The extensions are the same in both apps.

Read the real per-device download and install sizes from App Store Connect when the internal TestFlight build goes
up.

**Estimate for an iPhone after the strip and the App Store's thinning:**

| | Expo | SwiftUI |
| --- | --- | --- |
| Installed | about 52 MB | about 23 MB |
| Download | about 21.5 MB | about 12.5 MB |

The App Store's encryption of the executables can add a few megabytes to both downloads. So on an iPhone the Expo
app is about twice the SwiftUI app. React Native itself (React, Hermes, Expo's modules) and the JS bundle are the
difference, as on Android.

### iPhone

```
scripts/agent/locked pod -- bash -c 'cd apps/phone/ios && pod install'     after native dependencies change
scripts/agent/locked xcodebuild -- xcodebuild -workspace apps/phone/ios/Ardia.xcworkspace -scheme Ardia \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath <your own dir> ARCHS=arm64 CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- \
  DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= build                                   JS bundled in
agent-device install com.ardia.browser.ios <dir>/Build/Products/Release-iphonesimulator/Ardia.app
```

The ad hoc identity signs locally for the simulator with each target's entitlements (the app group, so the app and
its extensions share the SwiftUI app's container) and needs no account or profile. The Podfile adds
`apps/ios/Packages/ArdiaKit` to the `ArdiaPhoneNative` pod as a local Swift package (ArdiaBrowser and ArdiaDesign);
Xcode links ArdiaKit into the pod's library and copies its resource bundles into the app. The app target must not
link ArdiaKit itself, or every symbol is linked twice; it finds ArdiaDesign's module for its intents through
`SWIFT_INCLUDE_PATHS`. iOS 27 refuses to launch an app without the scene lifecycle, which Expo 54's template lacks, so
`SceneDelegate` starts React Native in the scene's window and hands links, quick actions and Handoff to the module.

The project carries the SwiftUI app's extensions, compiled from `apps/ios/Share`, `Action` and `Widgets` in place with
that project's Info.plists and entitlement files: the Share extension, Open in Ardia and the widgets, under the same
bundle ids. The SwiftUI app's intents need its `AppModel`, so the app target has its own copies with the same names,
titles and phrases that post links instead.

- `system.initialLink()` and `system.addLinkListener()`: `{ kind, source }` with kind `open` (url), `search` (query),
  `voiceSearch`, `incognito`, `tab` (id), `macTabs` or `inbox`, and source `web` (an http link from another app),
  `system` (an `ardia://` link from a widget, the share sheet or the action), `shortcut`, `share` (the share
  sheet's inbox, when it couldn't open the app), `handoff` or `intent`.
- `defaultBrowser`: `status()` from ArdiaBrowser's `DefaultBrowserStatus`, shared with the SwiftUI app;
  `requestRole()` is always false on iPhone, which has no role prompt; `openDefaultAppsSettings()`.
- `legacy.available()` and `legacy.read()`: the SwiftUI app's tabs, archive, history and preferences, read from a
  copy of its SwiftData store so the store itself is never opened. `-ArdiaLegacyDump YES` logs what `read()` returns
  (`ARDIA_LEGACY` lines) and `-ArdiaLegacyRestore YES` also opens the first saved tab, for checking an import;
  `-ArdiaLogSystemLinks YES` logs each link (`ARDIA_SYSTEM_LINK`). These need a test build (below).

#### Seeing a change on an iPhone simulator, beside main's SwiftUI app

Watch your own frames before you hand a change on. The loop, for any agent:

1. **Build.** `apps/phone/scripts/build-sim-app <name> [--commit REV]` makes `/tmp/ardia-phone/<name>.app` (Release,
   simulator, lab on) and `<name>.txt` beside it.
   - The JavaScript is bundled from a `git archive` export of REV (default HEAD), never the working tree.
   - The native app is built from the working tree once and cached under a hash of its inputs (`apps/phone/ios`
     with its Podfile.lock, `packages/phone/ios`, ArdiaKit, `app.json`, the module config, the lockfile, `patches`).
   - When those didn't change, only the bundle is rebuilt into a copy of the cached app, which is then re-signed ad
     hoc: about 25 seconds, against about 2 to 2.5 minutes for a full native build (504a9db41).
   - It refuses below 10 GB free, runs one at a time, and cleans its own scratch.
   - The `.txt` carries the commit, dirty, the bundle source, the native state, whether the native app was built or
     reused, and the bundle's sha256. The app logs the same at launch as `ARDIA build <commit> dirty: … from the …;
     native …`.
2. **Simulator.** In T3, `device_open` with host `simlock` and an id like `simlock:ios:iPhone 17 Pro` leases a booted
   simulator and returns its `agent-device` command; every tap, screenshot and launch goes through that command. The
   lease is wiped when it ends: close it with `device_close` (`shutdown: true`). Its udid, for `simctl`'s logs and
   recordings: `xcrun simctl --set ~/.simlock/devices/ios list devices booted`.
3. **Install and launch,** from the repo root (the lease accepts installs only from this checkout):
   `<agent-device> install com.ardia.browser.ios /tmp/ardia-phone/<name>.app`, then
   `<agent-device> open com.ardia.browser.ios --relaunch --launch-args -ArdiaDemo --launch-args YES`. Add
   `--launch-args -BrowseDeck --launch-args YES` to open on the deck. Confirm the build:
   `xcrun simctl --set ~/.simlock/devices/ios spawn <udid> log show --last 2m --style compact --predicate 'eventMessage CONTAINS "ARDIA build"'`.
4. **Record.** Start `xcrun simctl --set ~/.simlock/devices/ios io <udid> recordVideo --codec h264 --force run.mp4` in
   the background, act through `agent-device`, then `kill -INT` the recorder; `agent-device record` comes back empty
   under load. A still at device resolution: `<agent-device> screenshot shot.png --pixel-density 3` (3 px = 1 pt).
5. **Frames.**
   - Find the event by frame difference: `ffmpeg -i run.mp4 -vf "fps=60,scale=201:437,signalstats,metadata=print:key=lavfi.signalstats.YDIF" -f null - 2>&1 | grep YDIF`.
   - Pull 60 fps frames: `ffmpeg -i run.mp4 -vf fps=60 frames/f%04d.png`.
   - Or a sheet: `-vf "fps=60,select='between(n,START,END)',scale=134:291,tile=18x2" -frames:v 1 sheet.png`.
   - Measure positions, sizes and opacity from the pixels, not by eye.
6. **Main's SwiftUI app,** the reference for the iPhone redesign.
   - It has the same bundle id, so uninstall one app before installing the other
     (`xcrun simctl --set ~/.simlock/devices/ios uninstall <udid> com.ardia.browser.ios`).
   - A staged Release build is `/tmp/ardia-phone/swiftui-main.app`, with `swiftui-main.txt` saying from which commit.
     To make a fresh one (about 50 s), build `apps/ios/Ardia.xcodeproj` and copy out its `Ardia.app`:
     `scripts/agent/locked xcodebuild -- xcodebuild -project apps/ios/Ardia.xcodeproj -scheme Ardia -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath <your dir> ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= build`.
     Sign it ad hoc like this, never with `CODE_SIGNING_ALLOWED=NO`. The ad hoc build carries simulated entitlements
     (`application-identifier` `FAKETEAMID.com.ardia.browser.ios` and the app group), the same as `build-sim-app`'s
     Expo builds. Without them the app has no Keychain: Sync With Mac stops at "Couldn't save the sync key in your
     Keychain", and an upgrade can't carry the key over. Check with
     `otool -l <app>/Ardia | grep -c 'sectname __entitlements'` (1).
   - Its launch arguments: `-ArdiaDemo YES`, `-ArdiaDeck deck`, `-ArdiaInterfaceStyle classic`,
     `-ArdiaColorScheme dark`, `-ArdiaOpenSheet history`, `-ArdiaSpace <syncId>` (all in `SettingsLaunchHooks.swift`).
   - Record both apps doing the same thing in the same state, light and dark, and compare the same crop.
7. **Traps.**
   - A fresh lease's first keyboard shows the "Type English and Hindi" tip over the keys. Press its Continue, which
     appears in a plain `snapshot` (not `snapshot -i`), before typing, or a Go press does nothing.
   - In zsh, `$var:a…` is a modifier; write `${var}:path`.
   - Simlock has leased one simulator to two agents at once: the screens agent's lease id and mine were the same
     (a537518c…), and our taps and launches crossed, which spoiled a memory reading. Before measuring, check the
     device id `device_open` returned against the other agents' lease ids, and the udid's device type against the
     model you asked for (`plutil -extract deviceType raw ~/.simlock/devices/ios/<udid>/device.plist`).
   - One model per agent, always the same: the iPhone agent leases only `simlock:ios:iPhone 17 Pro`, the screens agent only `simlock:ios:iPhone 18 Pro`, the coordinator only `simlock:ios:iPhone 17`; on Android the Android agent takes Pixel 8 and the screens agent Pixel 9. A refused lease means wait, never another model.
   - `refused: this agent-device is too old to use through a gateway; update it` from a command `device_open` just returned means the lease was dropped (its simulator is no longer booted, usually under a load spike), not that the tool is old: check `simctl --set ~/.simlock/devices/ios list devices booted`, then lease again.
   - Before the first install on a lease, print its udid and list its installed apps: a lease starts empty, so an app already there is someone's live session. Close the lease without touching it and tell the coordinator.
   - Why: Simlock has twice handed one simulator to two agents while both were active (a537518c…, then 97D6E59E… on 2026-11-16, where one agent's install wiped the other's connected test app).
   - Close Search is pressed by coordinate, above the panel (e.g. `press 200 120`), in both apps: a press by its ref
     taps the centre of its full-screen frame, which the panel covers, so it closes neither ours nor main's. That says
     nothing about VoiceOver, whose activate runs the dim's accessibility action (92e0f865c); that needs a device.

#### Speed against the SwiftUI app

The question is whether the Expo app is slower than the SwiftUI app it replaces on iPhone. The bar is main's SwiftUI
app, built Release for the same simulator (`/tmp/ardia-phone/swiftui-main.app`), against a Release `build-sim-app`
build of the Expo app from head.

Three runs so far: on Expo 54 / React Native 0.81 (first table), on Expo 58 / React Native 0.88 with Reanimated's
settled re-render on (second table), and on 0.88 with it off (third table, cfbdc5050's
`FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS: false`). The third table is the current one.

Expo 54 / React Native 0.81: measured 2026-11-15 on one leased iPhone 17 Pro simulator (iOS 27), Expo at 5fbcd2308 and SwiftUI from main, at a
load under 10 and under `scripts/agent/locked perflab`. Each timed row is the median of five recordings, taken in
four rounds that alternate the apps. Times run from the first frame that changes to the last change before 0.5 s of
stillness. The recordings, frame scripts and pages are in `/tmp/ardia-phone-shots/iphone-agent-speed/`
(`rec/<app>-<measure>-<round><n>.mp4`, `analysis.json`).

| Measure | SwiftUI | Expo | Difference | Judgement | Simulator trust |
|---|---|---|---|---|---|
| App size on disk (simulator build) | 47.5 MB | 72.0 MB | +24.5 MB (+52%) | larger | Good for the difference; a device download is thinned and compressed. The extensions are equal (21 MB each); the gap is React Native and Hermes (16.9 MB of frameworks, a 5.5 MB bundle, a 2 MB larger binary). |
| Cold launch, first frame to settled | 395 ms | 410 ms | +15 ms (+4%) | level | Weak. The recording shows iOS's launch zoom over its cached launch snapshot, so it times iOS more than the app; the app's first own frame and a usable start page can't be told apart on video. Needs Instruments App Launch on a device. |
| Deck opening from a page, settled | 233 ms | 305 ms | +72 ms (+31%) | slower | Animation length and our own work carry over; GPU cost of the deck's glass and blur doesn't. SwiftUI's first change is the Tabs button's press, with motion 47 ms later; Expo shows no press and its first change is the motion. |
| Card opening from the deck, settled | 167 ms | 508 ms | +341 ms (3×) | slower | Carries over: the growth itself runs about 320 ms against SwiftUI's 167, and then the page jumps about 64 pt up and the bar appears at about 395 ms (the card's snapshot sits a status bar lower than the live page). Frames: `card-open-expo-frames.png`, `card-open-swiftui-frames.png`. |
| Search panel open to keyboard up and focused | 570 ms | 657 ms | +87 ms (+15%) | slower | Our part carries over; the keyboard's own animation is the simulator's. |
| Search submitted to the page's first paint (cached) | 112 ms | 95 ms | −17 ms | level | WebKit runs on the Mac's CPU; only the difference means anything. |
| Search submitted to settled | 515 ms | 382 ms | −133 ms (−26%) | faster | As above. |
| Tab swipe in the pager, settled (the 250 ms drag included) | 850 ms | 990 ms | +140 ms (+16%) | slower | The spring's length carries over. |
| Back and forward by edge swipe | cannot be measured | cannot be measured | | | agent-device's gestures can't start at the screen edge; needs a device. |
| Deck scrolling, frames over 34 ms per scripted swipe pair | 0 of 51–75 | 0 of 69–96 | none in either | level | Weak: simulator recordings are variable rate and not locked to the display, and the frame pacing is the Mac's. Hitches need Instruments Animation Hitches on a device. |
| Memory after nine tabs (app + WebKit) | 416 MB (154 + 263) | 387 MB (165 + 222) | −29 MB | level | The app process carries over roughly (Expo +11 MB). WebKit's content processes run 33 MB each in Expo and 40 MB in SwiftUI here, which a device's limits may not repeat. |
| Memory after a minute idle on the deck | 449 MB (185 + 264) | 388 MB (167 + 221) | −61 MB | lower | SwiftUI's app process grows 31 MB on the deck; Expo's 2 MB. As above for WebKit. |

What to fix before a device run, from these numbers:
- **Card opening** is the one real gap: three times as long, with a visible jump at the end. It is the screens
  agent's card handover.
- **Deck, search panel and pager** run 15–31% longer, which reads as the animations' set lengths and springs, not
  frame drops. Each is worth matching to SwiftUI's timing curve by curve.

Expo 58 / React Native 0.88: measured 2026-11-15, Expo at dc1bdecad (with the screens agent's main-token motion, 15c4af926,
and the card handover fix) against the same SwiftUI build, same simulator model, same method and pages, four
alternating rounds, five recordings per measure. The load stayed under 15 for rounds one to three; the last
SwiftUI round ended at 72, so its rows lean slow. Recordings and the analysis: `/tmp/ardia-phone-shots/iphone-agent-speed-088/`.

| Measure | SwiftUI | Expo 58 | Difference | Judgement | Against 0.81 |
|---|---|---|---|---|---|
| App size on disk (simulator build, `du -sk`) | 46.4 MB | 86.4 MB | +40.0 MB (+86%) | larger | Up from 72.0 MB: the app binary 29.1 MB (was 17.6; the new architecture's C++ and ExpoUI's SwiftUI link in statically), React Native's frameworks 20.2 MB (16.9), the bundle 5.4 MB, the extensions 21.0 MB as before |
| Cold launch, first frame to settled | 403 ms | 405 ms | +2 ms | level | level; still mostly iOS's launch zoom |
| Deck opening from a page, settled | 217 ms | 137 ms | −80 ms | faster | from +31%: the deck now runs main's arrive curve over 190 ms, which moves hard for 150 ms; main's spring has a longer tail |
| Card opening from the deck, settled | 172 ms | 293 ms | +121 ms (+70%) | slower | from 3×; the 64 pt jump is gone, and the bar's late arrival at about 290 ms is what remains |
| Search panel open to keyboard up and focused | 568 ms | 423 ms | −145 ms (−26%) | faster | from +15%: main's rise curve over 360 ms |
| Search submitted to the page's first paint (cached) | 130 ms | 83 ms | −47 ms | faster | as before, WebKit's own time |
| Search submitted to settled | 498 ms | 282 ms | −216 ms (−43%) | faster | |
| Tab swipe in the pager, settled (the 250 ms drag included) | 855 ms | 803 ms | −52 ms (−6%) | level | from +16%: main's 0.26/1 spring |
| Search panel's departure on Go: first change to the panel moving (773ee4ded, 3 runs each) | 285 ms (255–287) | 192 ms (178–192) | −93 ms | faster | was frozen 230–320 ms on 0.88 before MotionView; the screens agent's 50 ms strips show it gone by about 150 ms against main's 200 (`/tmp/ardia-phone-shots/lift-sim-58/`) |
| Back and forward by edge swipe | cannot be measured | cannot be measured | | | needs a device |
| Deck scrolling, frames over 34 ms per scripted swipe pair | 0 of 36–50 | 0 of 32–66 | none in either | level | weak on a simulator |
| Memory after nine tabs (app + WebKit) | 318 MB (124–129 + 189–194) | 360–415 MB (161–190 + 199–225) | +42 to +97 MB | higher | was lower on 0.81; the app process is 37–61 MB above SwiftUI's and WebKit 10–31 MB |
| Memory after a minute idle on the deck | 387–390 MB (186–189 + 201) | 356–401 MB (155–183 + 201–218) | −34 to +11 MB | level | |

Expo 58 / React Native 0.88 with Reanimated's settled re-render off: measured 2026-11-16 02:37–03:09, Expo's JS at
a987eb84b with native d82a2839d (Pods installed after cfbdc5050, so `RNReanimated.release.xcconfig` carries
`FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS:false`), against the same SwiftUI build. Same simulator model, method and
nine pages, four alternating rounds, five recordings per measure, load 2 to 4 throughout, under the perflab lock.
Evidence: `/tmp/ardia-phone-shots/iphone-agent-speed-nf/`.

| Measure | SwiftUI | Expo 58 | Difference | Judgement | Against the second table |
|---|---|---|---|---|---|
| Cold launch, first frame to settled | 402 ms | 403 ms | +1 ms | level | level |
| Deck opening from a page, settled | 240 ms | 133 ms | −107 ms | faster | Expo level (137); main's 217 read low last time |
| Card opening from the deck, settled | 175 ms | 265 ms | +90 ms (+51%) | slower | Expo 28 ms faster than 293 |
| Search panel open to keyboard up and focused | 578 ms | 418 ms | −160 ms (−28%) | faster | level |
| Search submitted to settled | 512 ms | 298 ms | −214 ms (−42%) | faster | level |
| Tab swipe in the pager, settled (the 250 ms drag included) | 848 ms | 800 ms | −48 ms (−6%) | level | level |
| Deck scroll, frames over 34 ms | 0 in 5 | 0 in 5 | none in either | level | level |
| Memory after nine tabs (app + WebKit) | 381–405 MB (138–153 + 243–252) | 380 MB (171–172 + 208–209) | −25 to 0 MB | level | was higher; within the run-to-run noise either way |
| Memory after a minute idle on the deck | 430–434 MB (183–184 + 246–251) | 380–395 MB (179–183 + 201–212) | −35 to −54 MB | lower | |

**Card opening, frame by frame** (one recording each, `expo-handover.png` in the evidence folder): both cards grow
to full size over the same 170 ms. Main's address bar arrives during the growth, so its open ends there. Expo's card
lands with its rounded corners and a sliver of the deck at the edge, holds still for 75 ms, then the bar appears and
the corners go square in one change. That late hand-over is the whole remaining gap. Turning the settled re-render
off took 28 ms off it, and nothing else moved beyond the noise.

What 0.88 leaves to fix, from these numbers:
- **Card opening** is still the one timed gap: 265 ms against 175 in the third table. The growth matches; the bar
  and the square corners arrive 75 ms after full size. The screens agent has it.
- **Memory after nine tabs** is higher than SwiftUI's and higher than on 0.81. Hermes V1 and Reanimated 4.7 had a
  known memory regression before Expo 57.0.17; 58.0.25 should carry the fix. Worth a device check before the owner's
  phone, and an Instruments allocation trace of the app process.
- **Size** grew by 14 MB with the upgrade and ExpoUI; a device download is thinned and compressed, so measure the
  App Store Connect size when the internal build goes up.

**Memory split** (2026-11-16, 773ee4ded, nine local pages each, the two apps one after the other on the same
simulator, `footprint` and `vmmap --summary`):

| | App | WebKit | Total |
| --- | --- | --- | --- |
| Expo | 189 MB | 225 MB | 414 MB |
| Main | 158 MB | 260 MB | 418 MB |

These totals are level. Between runs, though, the same build moves by 30 to 70 MB: main's WebKit read 189–264 MB on
the same nine pages. So the 0.88 table's "higher" is within the noise, and the split is the useful part.

Inside the app process, dirty plus compressed:

| Region | Expo | Main | What it is |
| --- | --- | --- | --- |
| Malloc small | 78 MB | 51 MB | Native objects: React's Fabric trees and the views behind them, Expo's modules, Expo UI's hosting. About 28 MB of React Native and Expo that main doesn't have. |
| Untagged anonymous | 39 MB | none | Hermes V1's heap, the JavaScript state. |
| CG raster data | 27 MB | 27 MB | Decoded page pictures. The same, so the kept-mounted deck costs no more than main's. |
| Image IO | 13 MB | none | ImageIO's cache of decoded images behind React Native's Image. |
| WebKit's allocator in the app | 3 MB | 48 MB | WebKit's UI-process state. Main keeps far more of it in its own process. |
| Loaded code's data | 15 MB | 15 MB | The same. |

Two things stand out:
- **Each WebContent process** is 33 MB in Expo and 40 MB in main, about 35 MB less over nine pages.
- **What's plainly ours to release** is the Image IO cache: 13 MB of decoded copies of pictures that are already on
  screen as raster data. React Native's Image keeps them for reuse. A memory-warning or background purge, or drawing
  the deck's pictures without RN's image cache, would free most of it.
- **Hermes's 39 MB** is the cost of running JavaScript. It can be checked for growth with
  `HermesInternal.getInstrumentedStats()` over a long session, but not removed.
- **Neither Hermes V1's known regression** (fixed by Expo 57.0.17, and this is 58.0.25) nor Expo UI shows as a
  region of its own here.
- **The search panel's lift** no longer holds: with the departure in MotionView (773ee4ded) it starts at Go. The hold
  itself (the app's frames not reaching the screen while a new page view comes in) is still there underneath, so
  any other motion that overlaps a page arriving should run in Core Animation too.

The method:
- **Setup:**
  - Both apps on one leased iPhone 17 Pro simulator, iOS 27.
  - Fresh install and onboarding, then the same nine local pages (`http://localhost:8766/p1.html` … `p9.html`, each a coloured header and text, so the network doesn't vary).
- **Recording:** each measure recorded five times with `simctl io recordVideo`, the two apps alternating in rounds.
- **Reading the frames:** times come from the frames.
  - The first frame that changes is the touch's own response, such as the button's press.
  - The first large change is the result starting.
  - The settle is the last change before 0.5 s of stillness.
  - The touch itself isn't in a simulator recording.

What a simulator can say:
- **Carries over:** how long our own logic and JavaScript take, and how long an animation is set to run.
- **Doesn't carry over:**
  - GPU cost, including Liquid Glass and blur;
  - frame pacing at 120 Hz (the simulator draws at the Mac's rate);
  - touch-to-screen latency;
  - thermal throttling;
  - launch on real storage;
  - WebKit's content-process memory and the device's memory limits.

#### Measuring speed on a real iPhone

What it needs, for a yes or no:

1. **The build.** A development-signed Release build of the Expo app, made with Xcode from `apps/phone/ios/Ardia.xcworkspace` (Release, a device destination).
   - Development signing keeps it debuggable, so Instruments can profile it. A TestFlight build can't be profiled that way.
   - It can't sit beside the TestFlight SwiftUI app as things are: both are `com.ardia.browser.ios`, with extensions `com.ardia.browser.ios.share`, `.open` and `.widgets`, and the app group `group.com.ardia.browser.ios`. Installing it replaces the SwiftUI app and its data on that phone.
   - The cleaner way is a second bundle id for measurement only: `com.ardia.browser.ios.measure`, built without the three extensions and the app group. Then both apps sit side by side and nothing of the owner's is touched. That's a build-setting change on our side, plus the signing below.
2. **The signing,** all the owner's to do (agents never touch the Apple developer account, certificates, profiles or the device list).
   - Register the phone's UDID in team U5L5T3NGVV's devices, or let Xcode do it while signed in as a team member with automatic signing, which is what the projects use (`CODE_SIGN_STYLE = Automatic`).
   - Let Xcode create a development certificate and profile for the bundle id. For the measurement id, that means an App ID `com.ardia.browser.ios.measure`, with no capabilities beyond the defaults if it's built without the app group.
   - On the phone, turn on Developer Mode (Settings › Privacy & Security › Developer Mode) and trust the Mac.
3. **The devices.**
   - The oldest iPhone that runs iOS 27 (the deployment target is iOS 27.0 in both apps). It shows the worst case for JavaScript, glass and memory.
   - A current one, with 120 Hz ProMotion, for frame pacing.
   - Which phones he has is his to say.
4. **The Mac.** This Mac, with Xcode 27.1, over a cable for the first pairing, then over the same network.
5. **The tools.**
   - Instruments' **App Launch** template (or `xcrun xctrace record --template 'App Launch' --device <udid> --launch -- com.ardia.browser.ios.measure`) for cold and warm launch.
   - **Animation Hitches** for the deck, the card opening, the tab swipe and scrolling: hitch time ratio and long frames, at 120 Hz.
   - **Time Profiler** for where JavaScript and native time goes.
   - **Allocations** and the VM Tracker for memory, with the WebKit processes counted.
   - Touch-to-screen latency: the phone's own screen recording at 60 fps shows the result but not the touch. A 240 fps slow-motion film of the phone, taken with another phone, shows both the finger and the frame.
   - MetricKit isn't needed for this: it reports field data a day later, from users' phones.
6. **What only a device can settle:**
   - launch time on real storage;
   - touch-to-screen latency, and the back and forward edge swipes;
   - the deck's and the bar's glass and blur cost and hitches at 120 Hz;
   - memory pressure and the WebKit processes;
   - heat over a long session;
   - energy.

   The simulator rows above settle only how long our own work and animations take, and app size.

#### Default browser on iPhone, once Apple grants the entitlement

Apple's web-browser entitlement (`com.apple.developer.web-browser`) has been requested. Until it is granted the
app ships with the default browser off, and one build setting turns all of it on together:

- **The switch.** `ARDIA_DEFAULT_BROWSER = NO` in the Debug and Release settings of the Ardia target in
  `apps/phone/ios/Ardia.xcodeproj/project.pbxproj`. Flip both to `YES` (or pass `ARDIA_DEFAULT_BROWSER=YES` to
  `xcodebuild`) for a build that should offer it.
- **The entitlement.** `CODE_SIGN_ENTITLEMENTS = $(ARDIA_ENTITLEMENTS_$(ARDIA_DEFAULT_BROWSER))`, so `NO` signs with
  `apps/ios/Config/Ardia.entitlements` and `YES` with `apps/ios/Config/Ardia-DefaultBrowser.entitlements`, the same
  file plus `com.apple.developer.web-browser`. The SwiftUI app's `apps/ios/project.yml` does the same, so both apps
  share the two files.
- **Info.plist.** `ArdiaDefaultBrowser` is `$(ARDIA_DEFAULT_BROWSER)`, which ArdiaKit's
  `DefaultBrowserStatus.isOffered` reads. The http and https `CFBundleURLTypes` iOS requires of a default browser are
  already declared and do nothing until the system lists Ardia.
- **What appears.** With `isOffered` true, `ArdiaPhoneDefaultBrowser.status()` returns `canAsk: true`: the
  onboarding step shows (unless asked within 100 days, as in SwiftUI), and Settings › Default Browser opens the
  system's Default Apps page. Page menu › Open in Default Browser hides once Ardia is the default. With `NO`,
  `isDefault` and `canAsk` are both false and none of this shows.
- **The signing side**, for the owner: the App ID `com.ardia.browser.ios` needs the Default Web Browser capability
  once Apple grants it, and the provisioning profiles regenerated with it. A build with `YES` and an old profile
  fails to sign, so it cannot ship half on.

`apps/phone/src/dev/defaultBrowserSwitch.test.ts` keeps this true: every configuration says `NO`, the entitlement and
the Info.plist key come from that one setting, and the two entitlement files differ only by the web-browser key.

#### Settings on Expo UI: main's SwiftUI screens, the checklist

The Expo UI Settings is compared against main's SwiftUI Settings (`apps/ios/App/Settings/`, read at 654d6396f),
screen by screen and row by row. Every row below names the SwiftUI main uses, so the Expo UI screen uses the same
view or our extension of it. Icon rows are `SettingsRowLabel(title, systemImage:, tint:)`: a `Label` whose icon is
`SettingsIconTile`; tints are `SettingsTint` (ArdiaDesign `SettingsTokens.swift`).

Whole stack (`SettingsView.swift`):
- `NavigationStack(path:)` with `navigationDestination(for: SettingsRoute)`; title "Settings", inline; toolbar
  `ToolbarItem(.confirmationAction)` "Done", semibold.
- `.tint(Palette.formAccent)` (#007AFF light, #0A84FF dark) and `.toggleStyle(SettingsSwitchStyle())`: a switch
  tinted `systemGreen`.
- Every page gets `.settingsChrome()`: `lookBackdrop()` (`scrollContentBackground(.hidden)` over
  `ProfileBackdrop().ignoresSafeArea()`), `scrollEdgeEffectStyle(.hard, for: .top)`, and the navigation bar's
  background `look.surface`, always visible.
- Pages with a hero use `.settingsPage(title)`: the inline title stays empty until the content scrolls past 150 pt
  (`onScrollGeometryChange`).
- Lists are `Form` with `.contentMargins(.top, Spacing.small)` (12 pt).
- Presentation: main uses a plain `.sheet(item:)` from `RootView`, with no presentation modifiers. On iPhone ours is
  Expo UI's `BottomSheet` with none either (`ExpoSettingsSheet`): system detent, corners, drag to dismiss and
  scaled-back page; Done and a drag both close Settings through `onIsPresentedChange`.
- Rule: a toolkit screen is hosted in a container the system positions, never inside a view we animate by
  transform, because SwiftUI records its accessibility frames at layout time and never updates them after our slide.
- Every toolkit screen's simulator pass reads three elements' frames from the accessibility tree (`snapshot --json`)
  and compares them with where the screenshot draws them.

Root (`SettingsRootList`), sections in order:
1. Sync row: `NavigationLink` to Sync; `SettingsIconTile("macbook.and.iphone", sync blue, baseSide 56)` (44 at
   accessibility sizes, stacked) beside a headline title and a subheadline secondary status (`.contentTransition(.opacity)`),
   6 pt vertical padding, one accessibility element.
2. Shortcuts: two capsule buttons, "Archive" and "Spaces", side by side 12 pt apart (stacked at accessibility
   sizes): body medium, full width, min height 48, `secondarySystemGroupedBackground` capsule, `PressableStyle`
   (scale 0.94 pressed, `Motion.press` spring 0.16/1). Row background clear, zero insets, section spacing 12.
3. Appearance: `NavigationLink` + `LabeledContent` (value: the summary, e.g. "Match My Mac" or "Blue, Glass, Dark");
   icon "paintpalette.fill" in the profile's swatch colour.
4. "Site Settings" ("globe", neutral #86888D); "Default Browser" ("safari.fill", #007AFF) only when
   `DefaultBrowserStatus.isOffered`.
5. "Search Engine" (`LabeledContent` with the engine's name, "magnifyingglass", #007AFF); `Toggle` "Search
   Suggestions" ("text.magnifyingglass", #458AFF); `Toggle` "Auto-Open Keyboard" ("keyboard.fill", #FFC829).
6. `Picker` "Archive Inactive Tabs" ("archivebox.fill", #B059EE) and `Picker` "Open App Links In"
   ("arrow.up.forward.app.fill", #3EA82E), both menu pickers tinted secondary; "Clear Browsing Data" link
   ("eraser.fill", #FF5A5F); "Export Open Tabs" ("square.and.arrow.up.fill", #0153FF): a `ShareLink` of the open
   tabs' addresses, or a toast when there are none.
7. "Show Onboarding" button ("hand.wave.fill", #FF901A, tinted primary); "About Ardia" link ("info", neutral).
   Footer: the version line, centred, 16 pt above.

Appearance (`AppearancePage.swift`, `ColorChoiceRows.swift`):
- Colour: the word "Color" over nine swatches in one row (`ColorSwatch`: 26 pt circle, a 2 pt ring 3 pt out when
  chosen, 44 pt hit height, `Motion.snappy` spring 0.2/1), then a `Toggle` "Match My Mac" when sync is on.
- "Interface Style" section: `CheckmarkRow`s Match My Mac, Glass, Classic (a semibold checkmark in `formAccent`,
  the row a plain `Button` tinted primary, `.isSelected` trait). Footer: "Match My Mac follows your Mac. Reduce
  Transparency in iOS Settings always uses Classic."
- "Light or Dark" section: `CheckmarkRow`s Match My Mac, System, Light, Dark. Footer: "Match My Mac follows your Mac.
  System follows this device."

Site Settings (`SiteSettingsPage.swift`):
- Toggles "Block Ads" ("hand.raised.fill", #FF5A5F), "Block Trackers" ("eyeglasses", #FFC829), "Block Cookie
  Banners" ("list.bullet.rectangle.portrait.fill", #FF901A); links "Filter Lists" (`LabeledContent` count,
  "line.3.horizontal.decrease", neutral) and "Trusted Sites" (count, "checkmark.shield.fill", #3EA82E).
- Pickers "Night Shade" ("moon.fill", #5856D6) and "Swipe to Navigate" ("hand.draw.fill", #458AFF); toggle "Collapse
  Bottom Bar" ("platter.filled.bottom.and.arrow.down.iphone", #30B0C7). Footer: "Change one site from its page menu."
- "Camera, Microphone and Location": allowed sites, "None" when empty, `.swipeActions` "Revoke" (destructive), and a
  `confirmationDialog` titled with the host listing "Revoke <permission>" per kind. Footer about private tabs.

Sync With Mac (`SyncSettingsPage.swift`): `SettingsHero` (tile 64, title2 bold, subheadline secondary, clear row) with
"Connect to Your Mac" when not connected; "What You Get" section; an attention section ("Choose Folder…" or
Connect Again); Devices list with `ProgressView`; "This iPhone's Name" `TextField`; "Sync Folder" `LabeledContent` +
"Change Folder…"; destructive "Stop Syncing…" with a `ProgressView`, confirmed by `confirmationDialog` "Stop Syncing
This Device?".

Connect to Your Mac (`SyncConnectPage.swift`): `SettingsHero`; "Two Steps" section of two `SetupStepRow`s (26 pt
numbered badge: green check when done, `formAccent` when current, tertiary fill when later; `Motion.snappy`), with
"Scan Code" and "Enter Words" buttons and a "Connecting…" `ProgressView`; footer about the Keychain. Recovery phrase
entry: a multiline `TextField`, a check line in `.ink(.green)` (`LegibleInk`, contrast 4.5:1 or 7:1), toolbar "Use
Phrase". The code scanner is a full-screen camera page, not a list.

Search Engine: a "From Your Mac" `LabeledContent` with footer "Set on your Mac." when synced, else a list of engines
with checkmarks.

Filter Lists: `SettingsHero`; lists with `Toggle`s and `ProgressView` while updating, footer "Checked weekly.";
"Add a List…" (a sheet with a URL `TextField`, Cancel and Add) and "My Filters" (`LabeledContent`); destructive
"Restore Defaults…" confirmed by a `confirmationDialog`. List detail: `Toggle` "Use This List", status rows as
`LabeledContent`, "Source" `Link`s, destructive "Remove List…" confirmed by "Remove This List?". My Filters: a
`TextEditor` with toolbar Revert and Apply and a "Filter Syntax" `Link`. Trusted Sites: a list with `.onDelete` and
an `EditButton`.

Clear Browsing Data: a "Time Range" `Picker`; "Clear" section of `Toggle`s History, Cache, Cookies and Site Data,
Archived Tabs; destructive "Clear Data…" with a `ProgressView`, confirmed by a `confirmationDialog`.

Default Browser: an explanation page with "How to change your default browser" and an "Open Ardia in Settings"
button. About: `AppIconPreview` (72 pt, 22.5% continuous corners, a 0.5 pt hairline) and "Ardia", three `Link` rows
(ardia.dev, Release Notes, Source Code), a footer, "Open Source Licenses" (each credit a `LabeledContent` and a
`Link`).

What Expo UI doesn't have and we add through its extension path (`ExpoUIView` views and
`ViewModifierRegistry` modifiers in a module that depends on `ExpoUI`), taken from ArdiaDesign so both apps share one
source:
- Views: `SettingsIconTile` (already public in ArdiaDesign), `SettingsRowLabel`, `SettingsHero`, `SetupStepRow`,
  `ColorSwatch` row, `CheckmarkRow`, `AppIconPreview`, `ProfileBackdrop`.
- Modifiers: `settingsChrome`, `settingsPage(title)`, `lookBackdrop`, `chromeSurface(in:interactive:tinted:)` (glass
  `.regular`/`.interactive()`, or Classic: `look.surface` or the background with a 0.5 pt stroke at 12%),
  `SettingsSwitchStyle`, `PressableStyle`, the `LegibleInk` text style.
- Tokens as values: `SettingsTint`, `Palette.formAccent`, `Spacing` (4, 8, 12, 16, 20, 24, 32), `Motion.press` and
  `Motion.snappy`.
- The app-only pieces are copied, not moved. `apps/ios/Packages/ArdiaKit/Sources/ArdiaDesign/SettingsPieces.swift`
  holds public copies of `SettingsRowLabel`, `SettingsHero` (built on a new `SettingsHeroContent`), `SetupStepRow`,
  `CheckmarkRow` (built on a new `CheckmarkLabel`), `ColorSwatch`, `AppIconPreview`, `PressableStyle`, `LegibleInk`
  and `SettingsSwitchStyle`, for the Expo screens; `SettingsTint.named(_:)` in `SettingsTokens.swift` maps the token
  names. The SwiftUI app keeps its own copies untouched (`apps/ios/App/Settings/SettingsComponents.swift`,
  `AppearancePage.swift`'s `CheckmarkRow`, `ColorChoiceRows.swift`'s `ColorSwatch`, `App/Browsing/BottomBar.swift`'s
  `PressableStyle`); its own types shadow the package's. Extension members don't shadow, so the package's are named
  `ardiaSettingsChrome()`, `ardiaSettingsPage(_:)` and `.ardiaInk(_:)`. The two are copies until `apps/ios` goes: a
  change to main's Settings pieces in those files has to be carried over to `SettingsPieces.swift` by hand.
- The Expo side: `packages/phone/ios/SettingsUIModule.swift` (`ArdiaPhoneSettingsUI`: the `ExpoUIView` views and the
  `ardia.*` modifiers registered in `OnCreate`) and `packages/phone/src/settingsUI.tsx` (one API for both phones;
  without the native module the views draw nothing and the modifiers are null).

The Expo app keeps one row main has no counterpart for: What's Sent (opt-in usage stats, the owner's approval).

Each Expo UI screen is checked against main's as it lands: the same rows in the same order, positions and sizes
from captures at the same scroll, type and colours light and dark, the push and pop between pages in 60 fps frames,
and scroll speed on the root list.

#### The Expo app on TestFlight, internal group first

Nothing here is run by an agent on its own: the coordinator picks the moment, and no agent uploads or touches the
Apple developer account. This is what the build needs and how the switch is proved.

**What the build is.**
- **App record:** the same as the SwiftUI app: "Ardia", bundle id `com.ardia.browser.ios`, team `U5L5T3NGVV`, and the
  extensions `.share`, `.widgets` and `.open`. The Expo project (`apps/phone/ios/Ardia.xcodeproj`) already uses these
  ids and the same entitlement files in `apps/ios/Config`: the app group `group.com.ardia.browser.ios`, and the default
  browser off (`ARDIA_DEFAULT_BROWSER = NO`).
- **Version and build number:**
  - The Apple version is the Mac's release version, as `docs/ios.md` › Releasing to TestFlight has it.
  - The build number goes above the highest one App Store Connect holds. On 15 Nov that is 0.2.47 (9), uploaded that
    day, internal "in testing", external "waiting for review" (`gh workflow run ios-release.yml -f mode=status`).
  - So the Expo build is 0.2.47 (10) or later, or the next release version's first build.
  - The project's committed 0.1.0 (1) is set at archive time on all four targets, as `scripts/release-ios.sh` does. It
    is never committed.
- **The release path** (9ac589838, 6dfe58539):
  - `apps/phone/scripts/release-ios <build> --version <release> [--unsigned | --no-upload]` is the Expo counterpart
    of `scripts/release-ios.sh`. It archives `apps/phone/ios/Ardia.xcworkspace` for a device in Release, with the
    release version on every target and `ArdiaReleaseVersion` in the app.
  - The commit's JavaScript is compiled with Hermes with the lab off, handed to the bundle phase through
    `ARDIA_PREBUILT_BUNDLE`, and stamped.
  - It refuses an uncommitted native tree or Pods behind `Podfile.lock`.
  - It checks the versions and build on all four targets, the three extensions, the stamp, Hermes bytecode, the test
    hooks off, the stripped frameworks, the app's dSYM matching its binary, default browser off and, when signed, the
    app group and web-browser entitlements.
  - The Settings footer follows main's `AppVersionLabel`: "Ardia 0.2.47 Nightly 2 (10)" from TestFlight.
  - `.github/workflows/ios-release.yml` gains `app: expo`. It installs the app's packages and Pods on the `xcode-27`
    runner and runs that script. An Expo upload with `public_testers` on is refused, so it can only reach the
    Internal group.
- **Proved without the Apple account** (2026-11-16): `release-ios 10 --version 0.2.47 --unsigned` on this Mac.
  - Every check passed, at 56.5 MB installed.
  - Every target reads 0.2.47 (10). The stamp gives JS 9ac589838, dirty no, native clean.
  - The dSYMs for the app, its extensions and ExpoModulesJSI are kept. The strip phase ran.
- **What is left to press, in order. None of it is an agent's to do on its own:**
  1. **Push this branch** (`git push origin t3/unify-expo-architecture`). GitHub holds e508d5cc5, without the release
     path. Or merge the branch into `main`.
  2. **A CI dry run**, which signs with the team's stored certificate but uploads nothing: `gh workflow run
     ios-release.yml --ref t3/unify-expo-architecture -f mode=dry-run -f app=expo -f version=<release version>`.
     - It runs from the branch: `ios-release.yml` exists on `main`, so it can be dispatched, and the run uses the
       branch's copy.
     - It needs the repository secrets the SwiftUI path uses: `NOTARY_KEY_P8`, `NOTARY_KEY_ID` and `NOTARY_ISSUER`
       (the App Store Connect key), and `IOS_DEVELOPMENT_P12` with `IOS_DEVELOPMENT_P12_PASSWORD` (the development
       certificate).
     - It runs on GitHub's `xcode-27` runner, with Xcode 27.1 and CocoaPods.
     - It is the first time this project signs with the team's identity. Automatic signing for the same four bundle
       ids as main's app should reuse their profiles. The run's logs show it.
  3. **The upload, the owner's moment:** `gh workflow run ios-release.yml --ref t3/unify-expo-architecture -f
     mode=upload -f app=expo -f public_testers=false -f version=<release version>`.
     - The build number is taken above App Store Connect's highest, from 10 on, unless `-f build=` sets it.
     - The release version must be the train the owner wants. 0.2.47 still has builds in review, so the next Mac
       release version is cleaner.
  4. **On the owner's phone:** install it from TestFlight over the SwiftUI app. Settings' footer should read "Ardia
     <version> Nightly (<build>)".
- **Who uploads, and how 0.2.47 (9) went up:**
  - The SwiftUI build was sent from `main` by the iOS Release workflow on 15 Nov (`gh workflow run ios-release.yml -f
    mode=upload`). The workflow archives, signs with the stored development certificate, and uploads with the App
    Store Connect API key the Mac release notarizes with (`NOTARY_KEY_P8`, `NOTARY_KEY_ID`, `NOTARY_ISSUER`). Then,
    because `public_testers` defaults to true, it submits the build to Public Testers for Beta App Review.
  - The Expo build goes the same way with `-f public_testers=false`, so it reaches only the Internal group. That
    means the owner and the team's App Store Connect users.
  - The workflow runs from the branch that holds the Expo release path (`--ref`), or from `main` once it is merged.
  - On a Mac, `scripts/release-ios.sh` does the same with the account Xcode is signed in to, or with `ASC_KEY`,
    `ASC_KEY_ID` and `ASC_ISSUER`.
- **On the owner's phone:**
  - TestFlight installs the Expo build over the SwiftUI app, the same bundle id with a higher build, so the app's
    container, Keychain and app group stay.
  - At first launch the Expo app imports the SwiftUI store once, through the legacy gate. The import covers tabs,
    saved states, the Archive, thumbnails, history and settings, in one transaction, with a receipt.
  - It keeps sync without reconnecting: the recovery phrase in the shared Keychain, and the folder's bookmark.
  - It leaves the SwiftUI store untouched. So installing an earlier build from TestFlight goes back to the SwiftUI app
    with its data, minus anything done since in the Expo app.

**When the Expo app replaces the SwiftUI app for public testers.** The owner has agreed, with no further OK, once
three things hold and the coordinator's report shows them:
1. The iPhone speed table is level with main's app ("Speed against the SwiftUI app").
2. The upgrade from the SwiftUI app passes on a copy of real data (below).
3. The build has been in the Internal group first.

After that the next upload goes with `public_testers` on, or `-f mode=public-link -f build=<n>` sends the internal
build.

**Proving the upgrade on a copy of real data.** On a leased simulator, never the owner's phone or live profile.
1. **Where real data comes from.**
   - A TestFlight app's container can't be read from a Mac. So the source is the owner's Mac Ardia profile, copied
     into a scratch folder (the repo's rule: copies only, never the live profile, nothing written back).
   - Delete `sync.json` from the copy before anything starts, so the copy never syncs to the owner's real iCloud
     folder.
   - `apps/phone/scripts/phone-sync-mac.mjs start` then runs a hidden Debug instance on that copy (its data folder in
     `<work>/mac`, which needs a `--seed <copy>` option added to the script). It turns sync on against
     `<work>/folder`, so the phone side gets the owner's real spaces, pinned tabs and open tabs from a Mac that
     isn't his.
2. **Set up main's SwiftUI app as the owner uses it** (`/tmp/ardia-phone/swiftui-main.app`, onboarding done):
   - Connect: Settings › Sync With Mac › Connect to Your Mac, Enter Words, with the phrase read from
     `<work>/phrase.txt` straight into the field (never printed, no screenshot while it shows). Then the folder:
     `<work>/folder` mirrored into the app's `Documents/Ardia Sync` and chosen there.
   - Then use it: at least nine tabs, two archived, about 30 pages visited, a private tab, every Settings row moved
     off its default, Site Settings, blocking (a trusted site, a My Filters line, one list off), the Reader's
     settings, and Appearance.
3. **Write down "before":**
   - screenshots of the deck, the Archive, History, every Settings page and Sync With Mac;
   - `mac sync`, which lists the phone's device id, name and tabs;
   - the Keychain and folder state as the Sync page shows them.
4. **Upgrade:** install the Expo build over it, the same bundle id with the container kept, as
   `ios-update-launch-check` does, and launch it. The import logs one `ardia-legacy imported …` line with counts per
   kind and no rejects beyond `notWeb` and `duplicate`.
5. **Compare "after" with "before":**
   - the same open tabs in the same order with the same tab selected, and the Archive's count;
   - an old visit found in History and in search;
   - every Settings, Site Settings, blocking, Reader and Appearance value;
   - each tab's back history (go back once).
6. **"No second connect", as it shows:**
   - Sync With Mac opens straight onto the connected page: the device list with the Mac, "This iPhone's Name"
     unchanged, the folder's name;
   - no "Connect to Your Mac" hero or step, and no attention section ("Choose Folder…", Connect Again);
   - `mac sync` lists exactly one iPhone, with the same device id as before, not a second device;
   - a tab sent from the Mac arrives once, and a page opened on the phone appears under its tabs on the Mac.
7. **Kill and relaunch twice:** no second import line, the same counts, still connected.
8. **Clean up:** `mac stop` deletes the scratch Mac and its folder; release the lease; delete the copy of the profile.

**How the simulator half is wired** (worked out on the stand-in run, 2026-11-16):
- **One folder for both sides, no relay.** The leased simulator's "On My iPhone" is the `File Provider Storage` of
  its `group.com.apple.FileProvider.LocalStorage` app group container under
  `~/.simlock/devices/ios/<udid>/data/Containers/Shared/AppGroup/` (read each container's
  `.com.apple.mobile_container_manager.metadata.plist` for `MCMMetadataIdentifier`). Make `Ardia Sync` there, and
  before `mac start` make `<work>/folder` a symlink to it. The Mac writes into it, and the phone's picker shows it as
  On My iPhone › Ardia Sync.
- **The phrase without a screen read:** on Enter Words, take one snapshot while the field is empty, to get the
  field's ref and the Use Phrase button. Then `<agent-device> fill <field ref> --text-stdin < <work>/phrase.txt`,
  which keeps the words out of argv and output, and press Use Phrase by its coordinates. Read the screen again only
  once it shows "Step 1, done".
- **The folder:** Choose Folder… › Browse › On My iPhone › Ardia Sync, then Open from inside the folder.
- **Main's app must be the ad hoc build** (the simulator section above). A `CODE_SIGNING_ALLOWED=NO` build connects
  but can't save the key.
- **Expect Appearance to change once connected:** Match My Mac follows the Mac profile, so a profile set to dark turns
  the phone dark.

**The stand-in run (not the proof).** The owner's profile isn't on this Mac, and copying it is his to allow. So the
tooling ran on a stand-in made through the app: `/tmp/ardia-phone-seed/standin-profile`, with its counts and recipe
in `MANIFEST.md` beside it. It has 4 spaces with 40 tabs, 7 pins, a pinned folder, a split, 613 URLs and 3,025 visits
over 79 days, ten settings off their defaults, and its own test sync identity. Chrome expires visits after 90 days,
so no real profile holds more history than that. How far it got:
- `mac start --seed` dropped the copy's `sync.json`, sync state and old key (1c83ccd5d) and came up with a new
  device id, the 40 tabs, and sync on against the linked folder.
- Main's app, the ad hoc build, onboarded and connected through the steps above. `mac sync` listed one `iPhone` phone
  device, and the phone listed the Mac "shiv" with "Updated just now". Appearance turned dark from the Mac's
  setting.
- The first attempt lost its simulator to Simlock under load, and the second to a double lease (the screens agent's
  install wiped main's app). The third ran to the end on lease f04ed0f4 (udid 97D6E59E), 2026-11-16 04:17–04:44.
  Evidence, with both stores, the Preferences plist, screenshots, trees and `mac sync` output:
  `/tmp/ardia-phone-shots/iphone-standin-upgrade/`.

**A fresh connect on 0.88** (2026-11-16, the Expo build at cb2876bc7, clean install on lease cfc7a246, a scratch Mac
seeded from the stand-in). Onboarding's Connect to Your Mac took the phrase (Enter Words, `fill --text-stdin`) and On My
iPhone › Ardia Sync, and showed "Connected." The Mac listed one new phone (ci7pa7gk…). A tab sent from the Mac arrived
once, marked from "shiv". A page opened on the phone appeared under its tabs on the Mac within one sync.

**The stand-in run's before and after** (the real run reads the same things the same way):

| Check | Before: main's SwiftUI app | After: the Expo build (a987eb84b) |
| --- | --- | --- |
| Open tabs, in order | 21, from `ZBROWSERTAB` in the app group's `Browser.store` | the same 21 URLs in the same order (`tabs` in `Documents/SQLite/browser.db`, diffed) |
| Archive | 2 (Hacker News, Pride and Prejudice) | the same 2 |
| History | 23 visits | the same 23 URLs (`visits`, diffed) |
| Saved page state | 20 tabs with interaction state | 23 `tab_state` rows |
| Settings | Search Suggestions off, Auto-Open Keyboard off, archive after 7 days, app links in App, Appearance Green and Classic with Match My Mac off | the same, in `preferences`; Settings reads the same rows |
| Synced from the Mac | Search Engine DuckDuckGo, the Personal space's pins | the same pins on the start page, four spaces |
| Import | none | `legacy.receipt` `{"tabs":21,"archive":2,"visits":23,"preferences":7}`, all records accounted for |
| Sync With Mac | connected: Mac "shiv", "This iPhone", folder Ardia Sync | opens on the connected page with the same devices and folder; no Connect step |
| The Mac's view (`mac sync`) | one phone, ckl2z6gj…, 21 tabs | the same one phone, the same id, 21 tabs |
| Mac to phone | | a tab sent from the Mac arrived once, marked from "shiv" |
| Phone to Mac | | a page opened on the phone appeared under its tabs on the Mac |
| Kill and relaunch twice | | the same counts each time and the same receipt, still connected |

Notes for the real run:
- **Read the import's result from the database, not the log.** A Release build's JavaScript `console.log` doesn't
  reach the system log, so the `ardia-legacy imported` line never shows. `legacy.receipt` in `preferences` holds the
  same counts.
- **The data container moves on install.** It gets a new UUID path, with main's files inside, so look it up again with
  `get_app_container` after installing. Main's store lives in the app group container, not the app's own.
- **Main's search opens a new tab for each submitted address,** so each tab has a one-page back history. To check back
  history, follow links within one tab instead.
- **Not exercised on the stand-in:** Site Settings, blocking (a trusted site, a My Filters line, a list off) and the
  Reader's settings. The real run should set those too.
- **Private tabs aren't stored,** so they don't carry over, by design.
- **Tooling:** the run is the scripted pieces above plus agent-device steps. The real run is the same steps with
  `--seed <the owner's copy>`.

#### Sync on iPhone

`ArdiaPhoneSync` on iPhone wraps the SwiftUI app's `SyncService` (ArdiaKit's ArdiaSync) whole, behind the same
interface and events as Android. `PhoneSyncHost` owns the one service: `AppDelegate` creates it in
`didFinishLaunching`, registers the background refresh task (`com.ardia.browser.ios.sync`) and starts it, so a
background launch with no scene runs a cycle without React Native. `SceneDelegate` tells it when the app becomes
active and resigns. Keys, the phrase's entropy and sealed bytes stay in Swift; only the typed phrase crosses, to
`connect`.

- **Continuing the SwiftUI app's sync.** Same bundle id, same container: the service reads `Application
  Support/Sync` (`sync.json`, `sync-state.nns`, `sync-journal.nns`, `sync-snapshot.nns`) and the `Ardia Sync Key`
  Keychain item, so a tester's phone keeps its device id and folder with no new connect.
- **The phone's data.** `packages/phone/ios/PhoneSync` (a Swift package the Podfile links into the pod) reads
  `Documents/SQLite/browser.db` read-only, one connection and one read transaction per cycle, with a busy timeout;
  the same rules as Android (open web tabs, 30 newest per profile, visits by page and profile, a missing file is an
  empty phone, a newer `user_version` fails the cycle). When the `-wal` and `-shm` files are gone it opens
  read-write with `query_only` on, since a read-only open can't start then. SyncService calls it on the main actor.
- **Sync's writes.** The inbox is `Application Support/PhoneSync/inbox.json` (excluded from backup), in Android's
  format and with its rules: replays add nothing, removals are merged and never dropped, an unreadable file is set
  aside, the next write refused and `inboxProblem` set.
- **Waiting for the import.** While the SwiftUI app's `Browser.store` exists and `legacy.markImported()` hasn't
  written `Application Support/PhoneSync/legacy-imported.json`, the source refuses to read and no cycle runs, in
  the foreground or in the background task; status says it is waiting. `legacy.imported()` reads the marker.
- **Widgets.** The host writes the Mac tabs widget's app-group snapshot with ArdiaDesign's `WidgetExporter`, the
  SwiftUI app's code, whenever the synced view changes.
- **Test build.** `ARDIA_TEST_BUILD=YES` on the xcodebuild line sets `ArdiaTestBuild` in Info.plist and
  `EXPO_PUBLIC_ARDIA_LAB=true` in the JS bundle phase; it is `NO` in the project, so a store build has no lab, no
  demo and no logging hooks. In a test build, `-ArdiaSyncDemo YES` swaps in `SyncService.demo` unless sync is set up,
  and `-ArdiaPageLab YES` opens the page lab. With Metro, start it with `EXPO_PUBLIC_ARDIA_LAB=true`.
- **Background refresh.** The app registers the task at launch and submits a request each time it resigns
  (the simulator's log shows `submitTaskRequest: <BGAppRefreshTaskRequest: com.ardia.browser.ios.sync …>`). On the
  iOS 27 simulator, `_simulateLaunchForTaskWithIdentifier:` from lldb on a backgrounded, suspended app did not run
  the handler. To check it on a device: run from Xcode, send the app to the background, pause, run
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.ardia.browser.ios.sync"]`,
  continue, and look for the Mac's latest send in `Application Support/PhoneSync/inbox.json`.

Edge swipes for back and forward are WebKit's own gesture. Simulator automation (agent-device swipes and pans from
the edge) has never triggered it; check it with a finger on a device or with the mouse in the Simulator window.

The first build takes about 25 minutes on a busy Mac; a native-only change rebuilds in 3 to 5, since the codegen and
Expo provider phases publish only files that changed.
