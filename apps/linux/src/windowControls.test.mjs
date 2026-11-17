import assert from "node:assert/strict";
import test from "node:test";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const windowsChrome = (await import("../../browser/src/lib/platformChrome.windows.ts")).WINDOW_CHROME;

function state(settings = {}, window = {}, extra = {}) {
  return {
    windows: { w: { id: "w", kind: "main", profileId: "p", fullScreen: false, ...window } },
    windowOrder: ["w"], ui: { focusOrder: ["w"] }, profiles: { p: { id: "p", name: "Personal" } }, profileOrder: ["p"], downloads: [], windowUi: {},
    ...extra,
    settings: { pageFrame: 9, tabLayout: "sidebar", sidebarSide: "left", addressBar: "toolbar", compactToolbar: false, hideToolbarWhileScrolling: false, autoHideTabs: false, sidebarWidth: 190, ...settings },
  };
}

test("Linux lays out its window like the Windows build: buttons on the right, a 32 px title band, nothing on the left", async () => {
  const linux = (await import("../../browser/src/lib/platformChrome.linux.ts")).WINDOW_CHROME;
  assert.equal(linux, windowsChrome);
  assert.deepEqual(linux, { leadingWidth: 0, trailingWidth: 171, titleBarHeight: 32 });
});

test("minimize and maximize reach the Linux host's window calls; caption regions are the shell's own drag regions", async () => {
  const calls = [];
  globalThis.window = { __ardiaHost: { bootstrap: { windowId: "main", profileId: "default" }, invoke: async (method, args) => void calls.push([method, args.args]), onEvent: () => () => {} } };
  const { windowControls } = await import("./hostWindowControls.ts");
  windowControls.minimize("main");
  windowControls.toggleMaximize("main");
  windowControls.setCaptionRegions("main", [[0, 0, 100, 32]]);
  await settle();
  assert.deepEqual(calls, [["ArdiaShell.minimizeWindow", ["main"]], ["ArdiaShell.toggleMaximizeWindow", ["main"]]]);
});

test("exactly one menu button in every layout: beside the window buttons while they're placed, in a header that never collapses away otherwise", async () => {
  const { menuBesideWindowButtons, linuxSidebarHeaderCollapsed, linuxDownloadsInSidebarFooter, sidebarHeaderCollapsed } = await import("./sidebarHeaderLayout.ts");
  const layouts = [{}, { compactToolbar: true }, { addressBar: "sidebar" }, { sidebarSide: "right" }, { addressBar: "sidebar", sidebarSide: "right" }, { tabLayout: "top" }, { autoHideTabs: true }, { minimalismMode: true }];
  for (const settings of layouts) {
    assert.equal(menuBesideWindowButtons(state(settings), "w", windowsChrome), true, JSON.stringify(settings));
    assert.equal(menuBesideWindowButtons(state(settings, { fullScreen: true }), "w", windowsChrome), false, JSON.stringify(settings));
    assert.equal(linuxSidebarHeaderCollapsed(state(settings, { fullScreen: true }), "w", windowsChrome), false, JSON.stringify(settings));
  }
  assert.equal(menuBesideWindowButtons(state({}, { kind: "small" }), "w", windowsChrome), true, "Little Ardia's bar holds it");
  const fullScreen = state({}, { fullScreen: true });
  assert.equal(sidebarHeaderCollapsed(fullScreen, "w", windowsChrome), true, "the Windows rule hides the header in full screen");
  assert.equal(linuxSidebarHeaderCollapsed(state(), "w", windowsChrome), true, "with the menu beside the buttons the header collapses as on Windows");
  assert.equal(linuxDownloadsInSidebarFooter(state(), "w", windowsChrome), true);
  assert.equal(linuxDownloadsInSidebarFooter(fullScreen, "w", windowsChrome), false);
});

test("the header's profile name makes room for the menu only when the header holds it", async () => {
  const { headerIndicatorLayout } = await import("./profileIndicatorLayout.ts");
  const layout = (room, named, menuInHeader) => headerIndicatorLayout({ room, textWidth: 60, named, menuInHeader });
  assert.equal(layout(120, false, true).width, 32);
  assert.equal(layout(120, false, false).width, 0);
  assert.equal(layout(120, true, true).width, 104);
  assert.equal(layout(120, true, false).width, 70);
  assert.equal(layout(40, true, true).shown, false);
  assert.equal(layout(40, true, false).shown, true);
});

test("the … button opens Linux's full app menu under the button that was pressed, once, and a second press closes instead of reopening", async () => {
  const { createClusterMenu } = await import("./clusterMenu.ts");
  let press;
  let open = false;
  const opened = [];
  const button = { name: "cluster …" };
  const glyph = { closest: (selector) => (selector === '[role="button"]' ? button : null) };
  const focused = { name: "focused" };
  const show = createClusterMenu({ addEventListener: (type, listener, capture) => type === "pointerdown" && capture && (press = listener) }, async (windowId, anchor) => void opened.push([windowId, anchor.name]), () => open, () => focused);
  press({ target: glyph });
  await show("w");
  assert.deepEqual(opened, [["w", "cluster …"]]);
  open = true;
  press({ target: glyph });
  await show("w");
  assert.equal(opened.length, 1);
  open = false;
  await show("w");
  assert.deepEqual(opened.at(-1), ["w", "focused"], "Enter or Space on the focused button anchors to it");
});

test("maximize turns into restore from the window's frame, read again on every resize, in browser windows and Settings alike", async () => {
  const { followWindowMaximized } = await import("./windowMaximized.ts");
  for (const windowId of ["w", "settings"]) {
    let frame = [80, 60, 900, 700];
    let resize;
    const noted = [];
    const replies = [];
    const host = { bootstrap: { windowId, profileId: "default" }, invoke: (method, args) => new Promise((resolve) => replies.push(() => resolve(method === "ArdiaShell.windowFrame" && args.args[0] === windowId ? frame : "wrong"))), onEvent: () => () => {} };
    const shell = { screen: { availWidth: 1440, availHeight: 870 }, outerWidth: 900, outerHeight: 700, addEventListener: (type, listener) => type === "resize" && (resize = listener) };
    followWindowMaximized(host, windowId, shell, (id, on) => noted.push([id, on]));
    await settle();
    replies.shift()();
    await settle();
    frame = [0, 30, 1440, 870];
    resize();
    resize();
    await settle();
    const stale = replies.shift();
    replies.shift()();
    await settle();
    stale();
    await settle();
    assert.deepEqual(noted, [[windowId, false], [windowId, true]], "a resize's older read never overrides a newer one");
    frame = null;
    shell.outerWidth = 1440;
    shell.outerHeight = 870;
    resize();
    await settle();
    replies.shift()();
    await settle();
    assert.deepEqual(noted.at(-1), [windowId, true], "without a frame (Wayland) the shell's own outer size decides");
  }
});

test("the shared store hears the synthesized maximized state, which is what turns the Windows glyph into restore", async () => {
  const { noteMaximized } = await import("./windowMaximized.ts");
  const { useMaximizedWindows } = await import("../../browser/src/state/windows/captionRegions.ts");
  noteMaximized("w", true);
  assert.deepEqual(useMaximizedWindows.getState(), { w: true });
  const before = useMaximizedWindows.getState();
  noteMaximized("w", true);
  assert.equal(useMaximizedWindows.getState(), before);
  noteMaximized("w", false);
  assert.deepEqual(useMaximizedWindows.getState(), {});
});
