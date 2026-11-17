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

test("Linux lays out its window with the Windows build's chrome", async () => {
  const linux = (await import("../../browser/src/lib/platformChrome.linux.ts")).WINDOW_CHROME;
  assert.equal(linux, windowsChrome);
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

test("one click on Close asks once: the caption button goes straight to Linux's close coordinator instead of confirming first and again in the coordinator", async () => {
  const { useBrowser } = await import("../../browser/src/state/browser/store.ts");
  const { setManagedWindowClose } = await import("../../browser/src/platform/windowClose.ts");
  const { startWindowCloseGuard } = await import("../../browser/src/state/windows/windowClose.ts");
  const { decideLinuxWindowClose } = await import("./windowCloseDecider.ts");
  const shared = await import("../../browser/src/state/windows/controls.ts");
  const stub = await import("../../browser/src/test-native/index.ts");
  const asks = [];
  const ask = async (options) => (asks.push(options.title), { confirmed: true, suppressed: false });
  stub.shellNativeModules.ArdiaDialogs.confirm = ask;
  startWindowCloseGuard();
  const S = () => useBrowser.getState();
  S().hydrate({ profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, profileOrder: ["default"] });
  S().updateSettings({ warnBeforeClosingWindow: true });
  S().createWindow({ url: "https://staying.ardia.test/" });
  const leaving = S().createWindow({ url: "https://one.ardia.test/" });
  S().newTab(leaving, { url: "https://two.ardia.test/" });
  const coordinator = [];
  setManagedWindowClose((windowId, reason) => {
    coordinator.push(windowId);
    void decideLinuxWindowClose(windowId, reason, ask);
    return true;
  });
  try {
    shared.closeFromWindowControls(leaving);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(asks, ["Close 2 tabs?", "Close 2 tabs?"], "the shared Windows path confirms, then the coordinator confirms again");
    asks.length = 0;
    coordinator.length = 0;
    const closed = stub.windows.closed.length;
    const linux = await import("./captionControls.ts");
    linux.closeFromWindowControls(leaving);
    await settle();
    assert.deepEqual(stub.windows.closed.slice(closed), [leaving], "Linux hands the close to the shell's coordinator, which asks once");
    assert.deepEqual(asks, []);
    assert.deepEqual(coordinator, []);
    assert.equal(linux.minimizeWindow, shared.minimizeWindow);
    assert.equal(linux.toggleWindowMaximized, shared.toggleWindowMaximized);
  } finally {
    setManagedWindowClose(() => false);
  }
});

test("never two menu buttons: the … while the window buttons are placed, otherwise the header's hamburger, whose header Linux never collapses", async () => {
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

test("beside the window buttons in a right sidebar, the profile name comes before back and forward", async () => {
  const { sidebarHeaderSplit } = await import("./profileIndicatorLayout.ts");
  assert.deepEqual(sidebarHeaderSplit(190, 0, 0, 45), { navigation: 114, indicatorRoom: 67 }, "without the buttons the header is as before");
  assert.deepEqual(sidebarHeaderSplit(260, 171, 32, 45), { navigation: 48, indicatorRoom: 32 });
  assert.deepEqual(sidebarHeaderSplit(320, 171, 75, 45), { navigation: 65, indicatorRoom: 75 });
  assert.deepEqual(sidebarHeaderSplit(190, 171, 0, 45), { navigation: 45, indicatorRoom: 0 });
  assert.deepEqual(sidebarHeaderSplit(400, 171, 0, 45), { navigation: 229, indicatorRoom: 0 });
});

function clusterHarness() {
  const listeners = {};
  let open = false;
  const opened = [];
  const menuButton = { name: "…" };
  const reload = { name: "Reload" };
  const inside = (button) => ({ closest: (selector) => (selector === '[role="button"][aria-label="Menu"]' && button === menuButton ? menuButton : null) });
  let focused = null;
  return {
    async load() {
      const { createClusterMenu } = await import("./clusterMenu.ts");
      this.show = createClusterMenu({ addEventListener: (type, listener, capture) => capture && (listeners[type] = listener) }, async (windowId, anchor) => void opened.push(anchor.name), () => open, () => focused);
    },
    press: (button) => listeners.pointerdown({ target: inside(button) }),
    key: (key) => listeners.keydown({ key }),
    focus: (button) => void (focused = button),
    setOpen: (value) => void (open = value),
    menuButton, reload, opened,
  };
}

test("the … opens Linux's full app menu under itself, and a second press while it's open closes it instead of reopening", async () => {
  const h = clusterHarness();
  await h.load();
  h.press(h.menuButton);
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
  h.setOpen(true);
  h.press(h.menuButton);
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
});

test("a click elsewhere never steers the … menu: after clicking Reload, Tab and Enter on the … anchor it to the …", async () => {
  const h = clusterHarness();
  await h.load();
  h.press(h.reload);
  h.focus(h.menuButton);
  h.key("Enter");
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
});

test("after a menu is dismissed by clicking outside, keyboard activation of the … opens it on the first press", async () => {
  const h = clusterHarness();
  await h.load();
  h.setOpen(true);
  h.press(h.reload);
  h.setOpen(false);
  h.focus(h.menuButton);
  h.key(" ");
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
});

function maximizedHarness(windowId, frameOf) {
  let resize;
  const frames = [];
  const noted = [];
  const replies = [];
  const host = { bootstrap: { windowId, profileId: "default" }, invoke: (method, args) => new Promise((resolve) => replies.push(() => resolve(method === "ArdiaShell.windowFrame" && args.args[0] === windowId ? frameOf() : "wrong"))), onEvent: () => () => {} };
  const shell = {
    screen: { availWidth: 1440, availHeight: 870 }, outerWidth: 900, outerHeight: 700,
    addEventListener: (type, listener) => type === "resize" && (resize = listener),
    requestAnimationFrame: (callback) => frames.push(callback),
  };
  return { host, shell, noted, replies, resize: () => resize(), frame: () => frames.splice(0).forEach((callback) => callback()) };
}

test("maximize turns into restore from the window's frame, read again once per animation frame of resizing, in browser windows and Settings alike", async () => {
  const { followWindowMaximized } = await import("./windowMaximized.ts");
  for (const windowId of ["w", "settings"]) {
    let frame = [80, 60, 900, 700];
    const h = maximizedHarness(windowId, () => frame);
    followWindowMaximized(h.host, windowId, h.shell, (id, on) => h.noted.push([id, on]));
    await settle();
    h.replies.shift()();
    await settle();
    frame = [0, 30, 1440, 870];
    h.resize();
    h.resize();
    h.resize();
    h.frame();
    await settle();
    assert.equal(h.replies.length, 1, "three resizes in one frame read the frame once");
    h.resize();
    h.frame();
    await settle();
    const stale = h.replies.shift();
    h.replies.shift()();
    await settle();
    stale();
    await settle();
    assert.deepEqual(h.noted, [[windowId, false], [windowId, true]], "an older read never overrides a newer one");
  }
});

test("without a frame, as on Wayland, the shell's outer size is compared with the screen; this test's fake screen has no panel, so outer equal to avail reads as maximized", async () => {
  const { followWindowMaximized } = await import("./windowMaximized.ts");
  const h = maximizedHarness("w", () => null);
  followWindowMaximized(h.host, "w", h.shell, (id, on) => h.noted.push([id, on]));
  await settle();
  h.replies.shift()();
  await settle();
  h.shell.outerWidth = 1440;
  h.shell.outerHeight = 870;
  h.resize();
  h.frame();
  await settle();
  h.replies.shift()();
  await settle();
  assert.deepEqual(h.noted, [["w", false], ["w", true]]);
});

test("a press on the … that never activated it, like a drag off the button, doesn't stop the next Enter from opening the menu", async () => {
  const h = clusterHarness();
  await h.load();
  h.setOpen(true);
  h.press(h.menuButton);
  h.setOpen(false);
  h.focus(h.menuButton);
  h.key("Enter");
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
});

test("a press outside while a menu was open is forgotten even when the … is then activated without a key, as assistive technology does", async () => {
  const h = clusterHarness();
  await h.load();
  h.setOpen(true);
  h.press(h.reload);
  h.setOpen(false);
  h.focus(h.menuButton);
  await h.show("w");
  assert.deepEqual(h.opened, ["…"]);
});
