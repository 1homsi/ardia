# Ardia for phones (Expo)

One Expo app for both phones, replacing `apps/ios` (SwiftUI) and `apps/android` (Compose) step by step (issue #1556).
Screens, app state and the data store are TypeScript; what has to be native is an Expo module wrapping the Kotlin and
Swift code that already exists. Both phones run it: Android and the iPhone.

## Layout

```
apps/phone/                 the app: Expo 54, React Native 0.81.6 (the Mac's versions), new architecture, Hermes
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

- **Runtime.** `ardia_hermes.cpp` builds against React Native 0.81's prefab Hermes, JSI and fbjni
  (`ARDIA_REACT_NATIVE_HERMES` picks the runtime options that Hermes has), so the process has one Hermes and sync
  gets its own runtime instance. `libardiahermes.so` needs only the `libhermes.so`, `libjsi.so` and
  `libfbjni.so` the app ships.
- **Bytecode.** React Native 0.81's `hermesc` rejects `async` functions and classes in `ardia-sync.js`, and
  its hidden `-block-scoping` flag crashes on it; there is no `-Xes6-block-scoping` in that compiler. So
  `CompileSyncBundle` (`packages/phone/android/build.gradle`) runs the bundle through Babel's class, block-scoping
  and async-to-generator transforms, the ones React Native applies to app code for this Hermes, then compiles it
  with React Native 0.81's `hermesc`, pinned by sha256. The Compose app compiles the same source with
  `hermes-compiler` 0.88.1 and `-Xes6-block-scoping`. The step proves the two cannot differ: Babel must leave
  no `let`, `const`, class, `async` or `await` (each loop variable a closure captures becomes its own `_loop`
  function, so a binding per pass does not depend on the engine); closures in loops, through the same
  transform, must keep each pass's value; the whole companion suite (`packages/sync/src/companion`) runs
  against the transpiled bundle; and the transpiled bundle must make the same host calls as the original.
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
- **Not ported.** The share sheet's Send to Your Mac (sharing opens the page in Ardia instead), and the Color
  setting's tint of the widgets.
- **Files.** A file request carries `offersPhoto`, `offersVideo` and `capturesDirectly` (the Compose app's
  `FileChooserPlan`); the answers `takePhoto` and `recordVideo` capture through the shared capture provider.
- **Open App Links In.** A global default (`pages.appLinksDefault`, `setAppLinksDefault`) with each site on,
  off or following it (`setOpensLinksInApps(host, null)`).

#### Entry points tester script (lab build)

`P=com.ardia.browser.android/.MainActivity`. Open the lab
(`adb shell am start -n $P --ez com.ardia.phone.PAGE_LAB true`), tap System, and watch
`adb logcat -s ReactNativeJS:I | grep "PAGELAB system"`. Each command should print one `PAGELAB system link`
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
15. **Sync, demo mode:** Stop Syncing turns the demo off (the card and the deck show the disconnected state);
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
26. **Telemetry, nothing while off:** watch `adb logcat -s PAGELAB | grep telemetry`. With sharing off (a fresh
    install starts off), use the app for a minute, background it and come back: no `PAGELAB telemetry posted`
    line. Turn on "Share anonymous usage stats" in Settings, background the app: lines appear
    (`POST ardia.dev/otel/v1/logs -> 200`). Turn it off: no more lines. The same switch is on onboarding's last
    steps (Settings › Show Onboarding). Settings › What’s Sent lists what is counted. A lab release build sends to
    ardia.dev with environment test.
27. **Memory after tabs close:** `adb shell am broadcast -a com.ardia.phone.MEMORY -p com.ardia.browser.android`
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
    `PAGELAB memory page closed: dropped N decoded snapshot(s)` with N of 1 or more for a tab that had a card, and
    the image cache after closing eight is no larger than with nine open. Then run
    `adb shell am send-trim-memory com.ardia.browser.android RUNNING_CRITICAL` (Android's own signal, which
    also trims the system's GPU caches; the lab's Trim only clears the image cache) and tap Memory again. Report
    all the lines, graphics included.
38. **Frames with and without the look:** measure twice, look on and look off, doing the same thing each time.
    - In the lab's Look, set the toggle (Look on or Look off; it logs `PAGELAB look views off|on` and lasts across
      launches), then `adb shell am force-stop $P` and open the app normally.
    - `adb shell dumpsys gfxinfo $P reset`, then for 30 s: open the deck, scroll it, open and close the tray over
      it, open a tab and go back. Then `adb shell dumpsys gfxinfo $P | grep -E "Janky|percentile"`.
    - With the look off, the deck and backdrops are flat colours and the frosts solid. Report both sets of lines,
      then switch the look back on.
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
    - Go submits the whole `google.com` (`PAGELAB completion submit "google.com"`). Leaving the field drops the
      highlight.
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
mac start                          # prints the phrase, the folder and the Mac's own device id
relay start --mac shiv:$W/folder   # checks the phone's folder with a probe file, then mirrors every 3 s
```

- `mac status` (or `mac sync` to sync first) prints every device the Mac sees with its id, name and kind, each
  device's open tabs, and the Mac's own tabs. `mac send https://example.com/x` sends a tab to the phone.
- `relay status` shows the last pass and the latest copies and deletions; `relay sync` runs a pass now.
- Connect the phone (Compose or Expo app): Settings › Sync With Mac › Connect to Your Mac. Step 1, Enter Words: put
  the cursor in the first word's field, then
  `adb -s $S shell input text "$(ssh shiv cat $W/phrase.txt | sed 's/ /%s/g')"`, or type the 24 words. Step 2,
  Choose Folder…: in the system picker open Documents › Ardia Sync, then Use This Folder and Allow.
- When done: `relay stop`, then `mac stop` (it quits the instance and deletes `$W`), then
  `adb -s $S shell rm -rf "/sdcard/Documents/Ardia Sync"`.

Checked without a phone: the Mac side started with the AGENTS.md rules (a Debug build, never the installed app,
`open -g -n`, `ARDIA_BACKGROUND=1`, a throwaway data folder), turned sync on, printed its phrase and devices, and
stopped cleanly. The relay ran on corex against shiv's folder with a stand-in for adb: copies, an idle pass,
deletions both ways and the loop. On shiv, a second hidden instance joined through the relayed folder with the
phrase; the Mac listed its id and its tab, and a tab sent from the Mac arrived once. Not yet run against a phone:
adb `exec-in`/`exec-out` and toybox `stat`/`find` on MIUI (the start probe checks them and stops before copying
anything), the app picking a folder the shell created and reading files the shell wrote, and typing the phrase
with `input text`.

#### Upgrade tester script

Use the Compose APK and the Expo upgrade APK built for this run (same key), named here `$COMPOSE_APK` and
`$EXPO_APK`. Watch `adb logcat -s ReactNativeJS:I ArdiaJS PAGELAB` throughout, and `adb logcat -b crash` for crashes.
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
     applies the native settings (no `ardia-legacy imported` line).
   - The same with `beforeMarker`, killing at `paused at beforeMarker`.
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
   - `mac send https://example.com/after-upgrade` arrives on the phone once (not twice, not again after a
     force-stop and relaunch).
   - A page opened on the phone (`https://example.com/opened-after-upgrade`) shows under the phone's tabs in the
     next `mac sync`.
   - Settings › Sync With Mac on the phone shows it connected to the Mac, with no folder picker and no phrase
     asked for.
   Report the `mac sync` output from step 3, after the import, and after step 9, and the `relay status` lines.
9. **Relaunch with no second import.** `adb shell am force-stop $P`, then open the app twice. Each time, the deck,
   the Archive and History have the same counts as step 7 (nothing doubled), no `ardia-legacy imported` line, and
   `example.com/held-a` does not open again.
10. **Install the Compose app back.** `adb install -r -d $COMPOSE_APK`. It opens with the tabs, Archive, visits and
    settings from step 2, as if the Expo app had never run. Run the `sha256sum` from step 3 again: every line
    matches.

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

## Telemetry

Off until the user chooses, in Settings (Share anonymous usage stats, with What's Sent) or on onboarding's last step. The consent model is the Mac's: nothing is sent, queued or counted while sharing is off, turning it off drops the queue, the day's counts and any request in flight at once, and an install ID is made only the first time sharing is turned on. Unlike the Mac, the phone sends no `daily_active` ping while sharing is off.

The gate is one file, `apps/phone/src/lib/telemetryGate.ts` (`createGate`): every capture, count and send goes through `isSharing()` there, and `state/telemetry/telemetry.ts` makes the app's one instance on the preferences table (`telemetry.sharing`, `telemetry.installId`, `telemetry.daily`, none of which the old iPhone app's import can set). The schema is `lib/telemetrySchema.ts`: every field is a fixed value, an enum, a bounded count or duration, or a version or UUID pattern, and a record that fails it is never queued. The OTLP encoding is shared with the Mac through `packages/core/src/telemetryWire.ts`.

Events (service `ardia-phone`, `$lib` `ardia-phone-telemetry`, tags `app: phone` and `platform: android|ios` on every one):

| Event | Fields | When |
| --- | --- | --- |
| `sharing_turned_on` | `source` (settings, onboarding) | turning sharing on |
| `app_launched` | `legacy_import` (imported, started_fresh, none), `legacy_import_failures` (failed tries before the app opened) | each launch with sharing on |
| `perf_launch` | `launch_ms`, `js_ms` | each launch, once the module gives the process start (`ArdiaPhoneSystem.processStartedAt()`, epoch ms) |
| `usage_counts` | `tabs_opened`, `searches`, `pins_to_mac`, `tabs_sent`, `page_processes_gone`, `links_given_up` (a link whose handling passed its 8 s deadline), `pages_reloaded_online` (a failed page reloaded when the phone came back online), `spaces_swiped` (a swipe in Spaces that changed the profile), `tray_hidden_rows_opened` (a tray row opened while it peeked or sat under the keyboard) | at most once a day, for the last UTC day the app was used before today, when anything was counted; private tabs are never counted |

On the dashboard they are kept out of every Mac section by source and lib (`PHONE_APP_SOURCE` in `apps/dashboard/src/server/sql.ts`).

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
| `links_given_up` | 16509434e | Whether a link's handling still hangs past 8 s; anything above zero is a bug to chase |
| `pages_reloaded_online` | b59e43a94 | Whether the reload on reconnect fires; near the line, worth striking once it is seen working |
| `spaces_swiped` | b9bb6e53e | Whether people find the swipe in Spaces or only use the switcher |
| `tray_hidden_rows_opened` | f5071fd5f | Whether rows past the keyboard are reached; near the line: zero would argue for a scrolling list, otherwise strike it |

## What is left before the Expo app replaces both native apps

The bar is the Compose app on Android and the SwiftUI app on iPhone, screen by screen and setting by setting:
what each tap does, what is remembered, animations and their timing. Every item is one line: what it is, where it
lives in the native app, and its size (small: an hour or two; a day; more). Anything not yet seen working on a
phone is listed as unverified, even where the code is in. Audited 2026-11-14 at 608a701c5.

Largest first: inline completion on iPhone (its native field), iPhone voice search, and the deck-to-page handover
(the page mounting as the open spring starts, and the page cover). Inline completion on Android, the tray's motion
and gestures, folder-before-phrase sync connect and the launch arguments are in and wait on a phone.

### Needs only JavaScript

- Trusted Sites: remove buttons always showing and removal not animated; both apps use Edit/Done (SwiftUI also swipe to delete) and a globe per row. `TrustedSitesPage` in `BlockingPages.kt`, `TrustedSitesPage.swift`. Small.
- Search Engine: the picker can list the Mac's custom engines and "Custom"; the From Your Mac row has no laptop icon. `SearchEngineNames.kt`, `GeneralPages.kt`, `SearchEnginePage.swift`. Small.
- Default Browser: at accessibility sizes both apps show a numbered list instead of the card; title weight, step icons and the iPhone button differ; on Android, when nothing can take the role request, Compose moves onboarding on. `DefaultBrowserPage.kt`, `DefaultBrowserPage.swift`. Small.
- About: the hero is the logo, not the 72 pt app icon with a shadow and bold title; the iPhone licences list Android-only libraries and miss the iPhone's own native code. `AboutPage` in `GeneralPages.kt`, `AboutPage.swift`, `apps/phone/test/credits.ts`. Small.
- Onboarding: the welcome icon isn't the 104 pt app icon on white (the app has no image of its icon to draw; needs one in the bundle). `OnboardingWelcomeStep.swift`, `OnboardingView.kt`. Small.
- Onboarding sync step: a symbol instead of the Mac-and-phone QR picture; the connect screen pops in (Compose slides it up, SwiftUI a sheet) and "Connected." doesn't crossfade. `SyncScanIllustration.kt`/`.swift`, `OnboardingSteps.swift`. Half a day.
- Sync: warnings are red (both apps orange); the scanner draws inside the sheet (both apps full screen) with a full rounded border instead of corner arms, wrong "can't scan" icons and a popping "Not an Ardia sync code". `SettingsComponents.kt` `warningInk`, `SyncCodeScanner.kt`/`.swift`, `SyncConnectPage.swift`. Small.
- Sync: Enter Words replaces the page instead of pushing one, its counter and footer don't crossfade, and on iPhone the keyboard isn't ASCII and doesn't dismiss on scroll; connect steps pop instead of animating. `RecoveryPhraseEntryPage` in `SyncPages.kt`, `RecoveryPhraseEntryPage.swift`, `SyncConnectPage.swift`. Small.
- Sync devices: rows say "5 minutes ago" (Compose "5 min. ago", SwiftUI nothing for other devices); the iPhone lacks the iMac, Studio and mini symbols; Stop Syncing on iPhone is a centred dialog, not an action sheet. `SyncDeviceWords.kt`, `SyncSettingsPage.swift`. Small.
- Spaces: the empty state's Sync With Mac opens Settings › Sync, not Connect; pinned tabs with a symbol show a favicon (`row.icon` never drawn); open groups, folders and devices are kept per profile only while the sheet is open (Compose keeps them across launches). `SyncedSpacesView.kt`, `SyncedSpacesView.swift`. Small.
- Spaces at large text and motion: rows don't wrap, icons and tiles don't grow, the switcher doesn't scroll when profiles overflow; the folder chevron, Show All and group expansion snap and the header doesn't crossfade; the banner uses Compose's icons on iPhone; rows and tiles have no accessibility action for their menu. `SyncedSpacesView.kt`, `SyncedSpacesView.swift`. Small.
- Page menu sheet: can't be dragged down to close (flick 800, or past 35% of its height capped at 120); it and the tab pager ignore Reduce Motion; the incoming pager card has no edge shadow though `incomingPose` computes it. `BrowsingSheet.kt`, `TrayDrag.kt`, `BrowsingRules.kt`, `TabPager.kt`. Half a day.
- Page menu: in toggle rows only the switch is tappable (Compose: the whole row, one Switch for TalkBack); at 1.3× text size Compose turns tiles into a list and stacks the zoom row; Open in Default Browser is disabled off web pages (Compose always enables it). `PageMenu.kt`. Small.
- Downloads toasts: a download refused at the start still says Downloading, ending incognito gives one toast per file instead of "Stopped N Private Downloads", and several icons differ. `AppModel.kt` `startDownload`/`announceDownload`, `Toasts.kt`. Small.
- Bottom bar: the recent-tabs menu shows "New Tab" for a tab without title or host (Compose: the address); the tab thumbnail reads only the saved file, so it lags about 700 ms (Compose uses the in-memory cover first). `BrowsingRules.kt`, `BottomBar.kt` `TabThumbnail`. Small.
- Loading placeholder under `BrowseLoadFreeze` (Compose's `PageLoadingPlaceholder`): the page cover now draws the tab's face, but the load-freeze capture still shows the page. `PageLayer.kt`. Small.

### Needs native code on Android

- A fade view, on both phones, built once to this shape: `FadeView` in `@ardia/phone-native` (module `ArdiaPhoneFade`), a container that multiplies its children's alpha by a linear ramp at each edge it is given. It serves the deck card header's 14-point trailing fade (`DeckCardHeaderItem` draws it with `BlendMode.DstIn`, SwiftUI with `.mask`) and the tray rows' fade at the keyboard's edge, which today fades whole rows (f5071fd5f). The deck backdrop is a native shader, so a gradient laid over the content can't stand in.
  - Props: `top`, `bottom`, `leading`, `trailing`, each `{ length: number; floor?: number } | undefined`: the ramp runs from full alpha at `length` points inside the edge down to `floor` (default 0) at the edge. `leading`/`trailing` follow the layout direction. All undefined, or a length of 0, draws the children unmasked at no cost.
  - The ramp follows the view's bounds every frame it is laid out, since the deck header's width animates on the UI thread; props change rarely and need not animate.
  - Android: an offscreen layer with a `DstIn` gradient per edge, as `DeckCardHeaderItem`. iPhone: a `CAGradientLayer` mask (or one per edge composited) resized in `layoutSubviews`.
  - Where the native view is missing (`requireOptionalNativeModule` returns null), the JS export is a plain `View` that ignores the fade props, and each caller keeps today's fallback: the deck title clips with no fade, the tray fades whole rows.
  - The deck uses `trailing: { length: 14 }`; the tray uses `bottom: { length: 0.3 × room, floor: 0.15 }` while its rows overflow. Small.
- Search field: inline completion is in the tray on Android (`CompletingField` through `TrayInput`, tester step 42), unverified on a phone; the tray's rise, drag, scrub, Paste and Go, the incognito toggle and the mic around it need a phone check with it.
- Search tray: no predictive back (the tray follows the back gesture down 72 dp); React Native's back handler gives no progress. `SearchTrayHost.kt` `PredictiveBackHandler`. A day.
- Share sheet: no Send to Your Mac (Compose's ShareActivity offers Open, Search and Send). `share/ShareActivity.kt`, `ShareSheetModel.kt`, `ShareSheetView.kt`. A day.
- Widgets: the Color setting doesn't tint them. `system/WidgetColors.kt`, `SystemSnapshotExport.kt`. Small.
- Page permission order: Compose asks Android for camera, mic or location first and shows the site's Allow dialog only once Android grants it (a refusal ends quietly); the app shows the site dialog first. Needs a check-or-request call before the dialog. `PageRequests.kt` `PermissionRequest`. Small.
- **Upgrade import, Start Without Them on the native side.** The JavaScript importer is in ("The importer" in "Upgrade from the Compose app on Android"). Start Without Them needs `legacyImport.startFresh()` on both phones: open the gate (sync, page settings, held links) without writing the import receipt, so `source()` still reports `pending` and a later version can import. Per-site desktop-site and blockers-off from Compose (`desktopSite.sites`, `blockersOff.sites`) need no screen: the page module should apply the desktop default when it loads that host and report it in `isDesktopSite` (the page menu reads that), and blockers-off should join the exempt hosts in `ardia-blocking`, which Trusted Sites lists. `PhoneLegacy.kt`, `PhonePages.kt`, `PhoneBlocking.kt`. Small.
- Sync connect: both apps pick the folder first, show its name and reuse it after a mismatch; the module's `connect(phrase)` opens the picker inside the call, so a retry asks again. Needs `pickFolder()` and `connect(phrase, folder)`. `SyncConnectSession.kt`, `SyncModule.kt`. A day (shared with iPhone).
- Pull to refresh settles on a 250 ms animator instead of Compose's snappy spring, in a fixed #007AFF instead of the accent; the swipe-to-navigate target falls back to black or white instead of the profile's surface. `PageGestures.kt` vs `PageLayer.kt` `animatePull`. Small.
- Tab pager corner radius is a fixed 55; Compose reads the display's real corner on Android 12+. `TabPager.kt` `rememberDisplayCornerRadius`. Small.
- Launch arguments: `launchOptions()` must return an `arguments` map holding every intent extra whose name starts with `Ardia` or `Browse` (booleans as booleans, the rest as strings), in lab and test builds only, and `ArdiaDemo` must also switch the module's sync demo on (today only `com.ardia.phone.SYNC_DEMO` does). The app reads, applies and demos everything else (6bf8a7201, d806a4f18, 24a6723c5, 6ad98f6e0). `PageViewModule.kt`, `LaunchArguments.kt`. Small.
- Keyboard target at the start of its animation: React Native reports the keyboard's height only once it has stopped, so the first keyboard of a process can't drive the tray's rise (it lands on the 450 ms spring) and a keyboard that changes height drives it from its last height. Needs the IME animation's target height as it starts (`WindowInsetsAnimationCompat.Callback.onStart`'s upper bound), e.g. an `onKeyboardWillChange { target, durationMs }` event on the system module. `TrayPresentation.kt` `KeyboardReader` (`imeAnimationTarget`). Small.
- Onboarding's step is lost when Android recreates the app; Compose keeps it with `rememberSaveable`. React Native has no saved instance state, so the module would need to hand the activity's saved bundle to JavaScript. `OnboardingView.kt`. Small.

### Needs native code on iPhone

- The fade view under Android's list (`FadeView`, `ArdiaPhoneFade`), to the same props: one interface on both phones.
- Voice search: no speech module, so the mic is hidden and voice links, the intent and the control fall back to the tray. `VoiceDictation.swift`. A day.
- Search field: no inline completion; needs a native field. `OmniboxTextField.swift` (`CompletingTextField`). More.
- Spotlight: open and archived tabs aren't indexed. `SpotlightIndexer.swift`. A day.
- Shortcuts and Siri: no Open Tab intent or tab entity in the app target (`apps/phone/ios/Ardia/Intents.swift`). `ArdiaIntents.swift` `OpenTabIntent`, `TabEntity.swift`. A day.
- Handoff: the current page isn't offered to other devices (incoming works). `SystemIntegrations.swift`, `AppModel+System.swift`. Small.
- Deck bar: SwiftUI's buttons are interactive Liquid Glass (`.glassEffect(.regular.interactive())`); the look module's Frost needs a glass variant that samples the deck. `TabDeckBar.swift`. A day.
- Context menus: SwiftUI uses system context menus (lift preview and blur) on cards, the plus button and archive rows, with ShareLink; the app draws its own. Also Spaces rows and folder tiles. Needs a native context-menu view. `TabSwitcherView.swift`, `TabDeckBar.swift`, `ArchiveView.swift`, `SyncedSpacesView.swift`. A day.
- Open in Background opens in front: the module drops `inBackground` from the link callback, and the app selects every popup. `WebTab.swift`, `PhonePages.linkOpened`. Small (plus a JS line).
- Offline pages never retry by themselves: failures carry no reason and there is no network module, so no online-again signal and no Wi-Fi-off icon. `WebTab.swift` `PageLoadFailure.network`. Small, plus an hour or two for an `NWPathMonitor` module.
- Per-site Open App Links In: `siteOpensLinksInApps`, `appLinksDefault` and `setAppLinksDefault` are missing, and clearing a site's choice (null) can't decode. `BrowsingPreferences.swift`. Small.
- Long-press on links and images uses WebKit's context menu (as SwiftUI does), so the app's drawn menu, Save Image and the Copied URL toast are Android-only; matching Android needs native long-press events. `WebTab.swift`. A day.
- Clear Browsing Data: cache and cookies are cleared for all time whatever range is picked; SwiftUI passes the range's start. Needs `since` on `clearWebsiteData`. `ClearBrowsingDataPage.swift`, `BrowsingPreferences.swift`. Small.
- Default Browser: `Linking.openSettings()` never calls `DefaultBrowserStatus.willOpenSystemSettings()`, so the status isn't re-checked on return and the page keeps its instructions. `DefaultBrowserPage.swift`, `PhoneSystem.swift`. Small.
- Sync connect: folder before phrase, as on Android. `SyncConnectPage.swift` `SyncConnectFlow`, `SyncModule.swift`. Shared with Android.
- Enter Words: Paste reads the clipboard and triggers iOS's Allow Paste prompt; SwiftUI uses the system `PasteButton`. `RecoveryPhraseEntryPage.swift`. Small to a day.
- Scanner: plain AVFoundation; SwiftUI uses VisionKit's `DataScannerViewController` with pinch to zoom and a highlight on the found code. `SyncCodeScanner.swift`, `ScanModule.swift`. A day.
- Launch arguments: `launchOptions()` must return an `arguments` map holding every launch argument whose name starts with `Ardia` or `Browse` (from the argument domain, `-ArdiaDemo YES` as a boolean), in test builds only, and `ArdiaDemo` must also switch the sync demo on (today only `ArdiaSyncDemo` does). `PageViewModule.swift`, `AppModel.swift`. Small.

### Unverified on a phone

- iPhone look views: `packages/phone/ios/LookModule.swift` is in progress (uncommitted); until it lands the iPhone draws gradients and solid fills. Check: the deck's animated backdrop and frosted controls, and Reduce Motion and Reduce Transparency switching them.
- Scroll position restore: scroll a long page, kill the app, relaunch; the same tab opens at the same offset, also after it was discarded in the background (both phones).
- Card snapshot on deck entry: open the deck right after scrolling; the card shows the current view.
- Deck gestures: a 400 ms hold opens the card menu without scrolling, a slow vertical drag lifts, a tap right after a settle opens the right card.
- Incognito chip: compare its tap with Compose's `IncognitoChip` (SwiftUI shows a one-item menu, as the app does).
- Voice from the tray: the keyboard goes down over the voice screen and comes back on the tray after Cancel.
- Tray rows that don't fit above the keyboard: the row after the last whole one peeks at the keyboard's edge, faded (each row takes SwiftUI's mask at the middle of its visible part, since the app has no mask view), and a scrub from the first row down into the keyboard opens the row laid out under the finger, with a tick per row on the way.
- Refine arrow with TalkBack and VoiceOver: reachable, read as "Refine <title>".
- iPhone Lock Screen widgets and Control Center controls open the right link (the app target has its own intent copies).
- iPhone search widget follows the profile colour and Match My Mac (`WidgetExporter.swift`).
- Android Paste and Go: "Link You Copied" for a link, "Text You Copied" for text (c872c609f).
- iPhone page permission prompts (camera, mic, location): Allow and Don't Allow from the app's dialog reach WebKit's grant.
- iPhone file upload: WebKit's own picker appears for a file input and Take Photo works (the module answers no file requests itself).
- iPhone fullscreen video covers the bottom bar and hides the status bar and home indicator.
- iPhone Share from the long-press menu is not shown under an open sheet.
- Android notification permission requests and the download notification compared with Compose's `PageRequests.kt`.
- Bar collapse spring and travel against Compose's `Motion.barCollapse` and SwiftUI's `BottomBar.swift`.
- Status-bar icons stay readable over the page menu, Reader and the long-press shade on both phones.
- iPhone Desktop Site reloads the page as SwiftUI's `toggleDesktopSite` does.
- The page's bar colour follows a page whose colour changes on scroll (Compose samples again 250 ms after a load and on scroll direction or top-of-page changes, `BrowsingView.kt`).
- A site's notification permission request, compared with Compose.
- iPhone: a toast raised from Settings (Cleared Browsing Data) shows above the sheet, as SwiftUI's own toast window does.
- A tab sent from the Mac shows a toast on both phones and tapping it opens the tab (SwiftUI `ReceivedTabsAnnouncer.swift`).
- Turning Match My Mac off with a Mac custom theme keeps the colour Compose's `choiceAfterMatchToggle` keeps.
- Site Settings and filter-list switches don't snap back for a moment while the native call and re-read run (`withBlocking`).
- iPhone confirmations (Restore Defaults, Remove List) are centred dialogs where SwiftUI uses action sheets; the owner should say whether the drawn-menus decision covers them.
- Where About and filter-list links open on iPhone (an Ardia tab or outside), against SwiftUI's `Link`.
- Imported deck snapshots on iPhone are absolute `file://` Caches paths; cards keep their images after an app update and after iOS clears Caches.
- iPhone default-browser step shows when SwiftUI's would (`DefaultBrowserStatus.isOffered`, asked within 100 days).
- A real SwiftUI-to-Expo upgrade skips onboarding (`state/app/boot.ts`).
- The scanner inside the sheet covers the screen, Cancel and Back stop the camera, and the status bar reads.
- A Spaces row opened from a Mac counts as a typed visit (`AppModel.kt` `openRemote`).
- The Spaces sheet can't be dragged closed while connecting (SwiftUI `interactiveDismissDisabled`).
- The recent-tabs long-press haptic against Compose's `BottomBar.kt`.
- A second flick during a pager settle neither jumps nor commits twice (`TabPager.kt`).
- The crash view's icon, title and Try Again match Compose (`PageLoadFailure.kt`).
- Not audited: Compose's `SyncSetupContent` internals inside onboarding, and the timing of DemoScenario's deck and pager scripts.
- Tray rise (796b78f6f): on both phones the tray comes up with the keyboard and sits on its top edge frame by frame (no gap, no overlap, including Android's navigation bar); with a hardware keyboard it lands after 450 ms; closing lets the keyboard go and follows it down; the dim fades in 300 ms; Reduce Motion fades instead of moving.
- Tray drag (9ecac6d12): a drag down on the field, the incognito caption or the empty area moves the tray and lightens the dim; past 8 points the keyboard goes down while the tray holds still; a short slow drag springs back and the keyboard returns; a long drag or a flick closes it.
- Tray scrub (7287c72fd): a finger on a row lights it at once; sliding along the rows ticks on each and opens the last on release (with a confirm); a tap on a query row's arrow refines; a 400 ms hold opens the row's menu; past 1.5x text size the list scrolls instead.
- Launch arguments, once both modules pass them: `ArdiaDemo` opens on the eight demo tabs (Sintra selected) with nothing written to the real store and the demo Macs in Spaces; each `Browse…` and `Ardia…` argument in `docs/android.md` and `docs/ios.md` does what it does in the native apps, at the same delays (6 s browse delay, 600 ms sheet, 1.5 s toast, 3 s deck open, 1.2 s deck script start); `ArdiaDeck` steps play in order; the pager freeze and script hold and swipe as Compose's do.
- Tray rows (2de3b7695): nine rows; typing "otter" keeps an "otter" search second; "!w otter" shows "Search Wikipedia"; a Mac tab shows a laptop and its host and opens as a synced tab; "12*12" reads "= 144", copies with a "Copied 144" toast on tap and offers Copy on a long press.
- Links (3f6409ae0): Search in Ardia on selected text and a web search open results at once; the voice shortcut opens the voice screen over the tray (Cancel lands on the tray, the keyboard down while voice is up and back after); a tab widget link restores an archived tab and does nothing for a private one; a page shared to Ardia on iPhone opens as shared.
- Tray look (9f98c466a): the caption, rows and empty tray crossfade; the Incognito label fades and grows from 0.9 at the toggle's edge; the field's text is title3 and grows with the text size; past 1.5x text size rows wrap; TalkBack and VoiceOver list Refine and each menu item as actions on a row.
- Start page (5c211809a): with no tabs and sync on, the leading button is Synced Tabs; the logo fades and grows from 0.92 and the bar fades as the tray comes and goes.
- Voice screen (c0fa87652): the transcript crossfades as words arrive; the logo has a soft shadow; on iPhone the waveform eases.
- Haptics (e043b58c2): with Android's touch feedback off, the app makes no haptics; on, the deck ticks per card while scrolling, taps on a flick-close and presses on confirming Close All; iPhone keeps its impacts.
- Deck behaviour (98bd12f97): Back from the deck opens the selected tab with the expand animation; the card menu lists Send to each device and Pin to Mac; a lifted card can't be tapped open; a deck of 40 tabs scrolls without mounting all cards.
- Deck look (5a3966c9c): cards fade in when the deck opens from the start page; the backdrop and bar fade with the open; snapshots fade in; two pages of one site share a placeholder colour; cards have the native shadow on both phones; a tab sent from the Mac shows "From Your Mac" until opened; the archive card scales in.
- Deck motion (77e3d1b15): a flicked card goes up in a white poof (blurred on Android); with Reduce Motion cards close, open and settle without springs.
- Archive (036e2dbef): day headers read Today, Yesterday, a weekday within six days, then the date (with the year only when it differs) and stay pinned with a tinted background; an empty Archive shows the archive tile even while searching; a search with no results shows the magnifier; rows show a plain favicon; restoring ticks; Delete All warns and is disabled when empty; Android Back clears a search first; on iPhone a swipe reveals Delete instead of deleting; a tab left for longer than the interval is archived within 15 minutes while the app stays open.
- Page (02416c672): bottom-bar buttons and a landed tab swipe give haptics; on iPhone pinning from the menu gives a success haptic, the title's message lasts 1 s and crossfades, the title moves under the buttons at accessibility sizes and Find opens 350 ms after the menu closes; the bar slides away under the find bar; a link's Copy Link says "Copied URL Without Trackers".
- Reader (e6005cbe8): text can be selected; a size change animates; a lead image that isn't a web address is skipped.
- Toasts (1b5d17668): a toast slides up from slightly smaller and slides down as it leaves; a finger holds it, a drag or flick down dismisses it, a short drag springs back and it leaves 1.2 s later; showing the same toast again doesn't replay it; with the keyboard up it sits at the top; VoiceOver reads it on iPhone; a tab from an iPhone shows a phone.
- Onboarding (06ff54ef1): steps slide 60 points with a fade both ways; leaving the welcome crossfades the backdrop; each step ticks and finishing gives a success haptic; the keyboard goes down between steps; on Android a quick Continue on the welcome still shows the default-browser step; at the largest text sizes each step scrolls; with Reduce Motion the welcome fades.

### Deliberately different

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
- The deck bar sits 6 points above a three-button navigation bar instead of on it (2db78f033); gesture navigation keeps Compose's numbers.
- Find on Page is the app's own bar on both phones, not WebKit's find panel as in SwiftUI (e508b6dd2); the commit gives no reason, so the owner should confirm it.
- Opt-in usage stats (Settings, What's Sent, onboarding's last step) exist only in the Expo app (c6ebf08a8, the owner's approval).
- Settings has no Appearance or Downloads rows because Compose has neither (f5d1ec9f2).
- Toasts sit above the deck bar's measured top, not a fixed 64 dp, so they never cover + (87e9ed9e6).
- After a reload the failure screen stays until that load ends, so the WebView's own error page never shows (becf40624).
- Labs and the sync demo are gated by the build (`ARDIA_LAB`, `ARDIA_TEST_BUILD`), not by a debuggable build as in Compose (4f474ff95).
- The Sync page's inbox-problem notice exists only in the Expo app (d9b85412f).
- Licences are generated from the shipped code, not a hand-written list (aa44da003); the iPhone list's content is the gap above.
- For the owner to confirm, no commit says why: the sync demo runs over the real tab store (76dcdde8a); Reset › Connect Again acknowledges the reset first as Compose does (SwiftUI just navigates); iPhone Spaces shows a Bookmarks section that SwiftUI lacks (253515009).
- The tray's rows end at the last whole row and don't scroll at normal text sizes, so no partial row is drawn for a fade mask (992441306, 7287c72fd); both apps clip with a fade instead.

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
