import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { usePages } = await import("../tabs/pageState.ts");
const { useExtensions } = await import("./store.ts");
const { refreshActionStates } = await import("./actionStates.ts");
const panels = await import("./sidePanels.ts");
const { extensionMenuItems } = await import("./actions.ts");

const S = () => useBrowser.getState();
const E = () => useExtensions.getState();
const EXT = { id: "ext", name: "Ext", enabled: true, pinned: true, hasAction: true, incognito: false, sidePanel: "panel.html" };

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "b.com", background: true });
  usePages.setState({ ready: { [a]: 1, [b]: 2 } });
  useExtensions.setState({ lists: { "": [EXT] }, actions: {}, popup: null, sidePanels: {} });
  const asked = [];
  const ask = (what) => (tabId) => new Promise((resolve) => asked.push({ what, tabId, resolve }));
  native.extensionAnswers.actionStates = ask("states");
  native.extensionAnswers.sidePanelUrl = ask("panel");
  const answer = async (i, value) => {
    asked[i].resolve(value);
    await new Promise((r) => setImmediate(r));
  };
  return { w, a, b, asked, answer };
}

test("a tab switch while a tab's states are on their way gets its own states right after, with no timer", async () => {
  const { a, b, asked, answer } = setup();
  S().activate(a);
  const first = refreshActionStates();
  assert.deepEqual(asked.map((x) => x.tabId), [a]);
  S().activate(b);
  const second = refreshActionStates();
  assert.equal(asked.length, 1, "one pass at a time");
  await answer(0, { ext: { badgeText: "A" } });
  assert.deepEqual(asked.map((x) => x.tabId), [a, b], "the switch ran a pass as soon as the first ended");
  await answer(1, { ext: { badgeText: "B" } });
  await Promise.all([first, second]);
  assert.equal(E().actions[a].ext.badgeText, "A");
  assert.equal(E().actions[b].ext.badgeText, "B");
});

test("A→B→A shows A's side panel whatever order Chrome answers in", async () => {
  const { w, a, b, asked, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opened;
  assert.equal(E().sidePanels[w].url, "chrome-extension://ext/a.html");
  S().activate(b);
  void panels.syncSidePanel(w);
  S().activate(a);
  void panels.syncSidePanel(w);
  assert.deepEqual(asked.map((x) => x.tabId), [a, b, a]);
  await answer(2, "chrome-extension://ext/a.html");
  await answer(1, "chrome-extension://ext/b.html");
  assert.equal(E().sidePanels[w].url, "chrome-extension://ext/a.html", "B's late answer is dropped");
  panels.closeSidePanel(w);
});

test("two tabs with the same panel URL: the panel follows the tab that is shown", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/shared.html");
  await opened;
  assert.equal(E().sidePanels[w].tabId, a);
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/shared.html");
  assert.equal(E().sidePanels[w].tabId, b);
  panels.closeSidePanel(w);
});

test("a tab without a panel of its own hides the panel, and coming back shows the same one", async () => {
  const { w, a, b, asked, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opened;
  const panelOfA = E().sidePanels[w];
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, null);
  assert.equal(E().sidePanels[w].hidden, true);
  assert.deepEqual(panels.wantedSidePanels(), [[w, "ext"]]);
  S().activate(a);
  void panels.syncSidePanel(w);
  await answer(2, "chrome-extension://ext/a.html");
  assert.equal(E().sidePanels[w].hidden, undefined);
  assert.equal(E().sidePanels[w].url, panelOfA.url);
  assert.equal(asked.length, 3);
  panels.closeSidePanel(w);
});

test("closing one tab's side panel keeps the other tab's panel", async () => {
  const { w, a, b, asked, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  S().activate(a);
  void panels.syncSidePanel(w);
  await answer(2, "chrome-extension://ext/panel.html?tabId=a");
  panels.closeSidePanelOnTab(w);
  assert.equal(E().sidePanels[w].hidden, true, "A's panel is closed");
  assert.equal(panels.panelClosedOnTab(w, a), true);
  assert.deepEqual(panels.wantedSidePanels(), [[w, "ext"]], "the window keeps its panel for B");
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(3, "chrome-extension://ext/panel.html?tabId=b");
  assert.equal(E().sidePanels[w].hidden, undefined, "B's panel shows again");
  assert.equal(E().sidePanels[w].tabId, b);
  S().activate(a);
  await panels.syncSidePanel(w);
  assert.equal(E().sidePanels[w].hidden, true, "A stays closed");
  assert.equal(asked.length, 4, "A's closed panel isn't asked for again");
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(4, "chrome-extension://ext/panel.html?tabId=b");
  panels.closeSidePanelOnTab(w);
  assert.equal(E().sidePanels[w], undefined, "closing the last tab's panel closes it for the window");
  assert.deepEqual(panels.wantedSidePanels(), []);
  assert.deepEqual(asked.map((x) => x.tabId), [a, b, a, b, b], "each panel URL was asked for the shown tab");
});

test("a tab whose panel was taken away no longer keeps the window's panel open", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  void panels.syncSidePanel(w);
  await answer(2, null);
  S().activate(a);
  void panels.syncSidePanel(w);
  await answer(3, "chrome-extension://ext/panel.html?tabId=a");
  panels.closeSidePanelOnTab(w);
  assert.equal(E().sidePanels[w], undefined);
  assert.deepEqual(panels.wantedSidePanels(), []);
});

test("a tab whose panel the extension takes away drops its page", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  void panels.syncSidePanel(w);
  await answer(1, null);
  assert.equal(E().sidePanels[w].hidden, true);
  assert.equal(panels.panelDroppedOnTab(w, a), true);
  assert.equal(panels.panelClosedOnTab(w, a), false, "the extension removing it isn't the user closing it");
  void panels.syncSidePanel(w);
  await answer(2, "chrome-extension://ext/panel.html?tabId=a");
  assert.equal(E().sidePanels[w].hidden, undefined, "the panel comes back when the extension restores it");
  assert.equal(panels.panelDroppedOnTab(w, a), false);
  void panels.syncSidePanel(w);
  await answer(3, null);
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(4, null);
  assert.equal(panels.panelDroppedOnTab(w, b), false, "a tab that never had a panel isn't marked");
  panels.closeSidePanel(w);
});

test("the toggle while a tab switch's panel is being looked up closes the panel for the tab switched to", async () => {
  const { w, a, b, asked, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  assert.equal(asked.length, 2);
  void panels.toggleSidePanel(w, "ext");
  assert.equal(panels.panelClosedOnTab(w, b), true);
  assert.equal(panels.panelClosedOnTab(w, a), false);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  assert.equal(E().sidePanels[w].hidden, true, "the late answer for B is dropped");
  assert.equal(E().sidePanels[w].tabId, a);
  S().activate(a);
  void panels.syncSidePanel(w);
  await answer(2, "chrome-extension://ext/panel.html?tabId=a");
  assert.equal(E().sidePanels[w].hidden, undefined, "A's panel is still there");
  assert.equal(E().sidePanels[w].tabId, a);
  panels.closeSidePanel(w);
});

test("opening the side panel again on a tab where it was closed brings it back", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  panels.closeSidePanelOnTab(w);
  assert.equal(panels.panelClosedOnTab(w, b), true);
  const reopened = panels.toggleSidePanel(w, "ext");
  await answer(2, "chrome-extension://ext/panel.html?tabId=b");
  await reopened;
  assert.equal(panels.panelClosedOnTab(w, b), false);
  assert.equal(E().sidePanels[w].hidden, undefined);
  assert.equal(E().sidePanels[w].tabId, b);
  panels.closeSidePanel(w);
  assert.equal(panels.panelClosedOnTab(w, a), false, "a full close forgets the closed tabs");
});

test("the X while the tab switched to is still loading closes the panel for that tab, not the one left", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  usePages.setState({ ready: { [a]: 1 } });
  S().activate(b);
  panels.closeSidePanelOnTab(w);
  assert.equal(panels.panelClosedOnTab(w, b), true);
  assert.equal(panels.panelClosedOnTab(w, a), false);
  assert.equal(E().sidePanels[w].hidden, true);
  panels.closeSidePanel(w);
});

test("a panel whose tab moved to another window no longer keeps this window's panel open", async () => {
  const { w, a, b, asked, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  assert.equal(panels.panelTabOpen(w, b), true);
  const other = S().createWindow({ url: "c.com" });
  S().moveTabsToWindow([b], other);
  assert.equal(panels.panelTabOpen(w, b), false);
  S().activate(a);
  panels.closeSidePanelOnTab(w);
  assert.equal(E().sidePanels[w], undefined);
  assert.equal(asked.length, 2);
  panels.closeSidePanel(w);
});

test("opening the side panel again on a tab that is still loading takes back its close", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  usePages.setState({ ready: { [a]: 1 } });
  S().activate(b);
  panels.closeSidePanelOnTab(w);
  assert.equal(panels.panelClosedOnTab(w, b), true);
  void panels.toggleSidePanel(w, "ext");
  assert.equal(panels.panelClosedOnTab(w, b), false);
  usePages.setState({ ready: { [a]: 1, [b]: 2 } });
  void panels.syncSidePanel(w);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  assert.equal(E().sidePanels[w].hidden, undefined);
  assert.equal(E().sidePanels[w].tabId, b);
  panels.closeSidePanel(w);
});

test("a panel page closing while another tab's panel is being looked up closes only its own tab", async () => {
  const { w, a, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  assert.equal(panels.closeSidePanelOnTab(w, a), false);
  assert.equal(panels.panelClosedOnTab(w, a), true);
  assert.equal(panels.panelClosedOnTab(w, b), false);
  await answer(1, "chrome-extension://ext/panel.html?tabId=b");
  assert.equal(E().sidePanels[w].hidden, undefined);
  assert.equal(E().sidePanels[w].tabId, b);
  assert.equal(panels.closeSidePanelOnTab(w, b), true);
  panels.closeSidePanel(w);
});

test("the X on the only open panel closes it for the window", async () => {
  const { w, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/panel.html?tabId=a");
  await opened;
  panels.closeSidePanelOnTab(w);
  assert.equal(E().sidePanels[w], undefined);
  assert.deepEqual(panels.wantedSidePanels(), []);
});

test("opening the side panel from a tab without one while it is hidden opens instead of closing", async () => {
  const { w, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, null);
  assert.equal(E().sidePanels[w].hidden, true);
  const toggled = panels.toggleSidePanel(w, "ext");
  await answer(2, "chrome-extension://ext/b.html");
  await toggled;
  assert.equal(E().sidePanels[w].url, "chrome-extension://ext/b.html");
  assert.equal(E().sidePanels[w].hidden, undefined);
  panels.closeSidePanel(w);
});

test("closing a hidden side panel removes it", async () => {
  const { w, b, answer } = setup();
  const opened = panels.openSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opened;
  S().activate(b);
  void panels.syncSidePanel(w);
  await answer(1, null);
  panels.closeSidePanel(w);
  assert.equal(E().sidePanels[w], undefined);
  assert.deepEqual(panels.wantedSidePanels(), []);
});

test("a second click on the side panel button while it opens closes it", async () => {
  const { w, asked, answer } = setup();
  const opening = panels.toggleSidePanel(w, "ext");
  panels.toggleSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opening;
  assert.equal(E().sidePanels[w], undefined);
  assert.deepEqual(panels.wantedSidePanels(), []);
  assert.equal(asked.length, 1);
});

test("closing the side panel while it opens keeps it closed", async () => {
  const { w, answer } = setup();
  const opening = panels.openSidePanel(w, "ext");
  panels.closeSidePanel(w, "ext");
  await answer(0, "chrome-extension://ext/a.html");
  await opening;
  assert.equal(E().sidePanels[w], undefined);
});

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items, depth = 0) =>
  items.flatMap((i) => [
    "  ".repeat(depth) + (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.swatch ? "(swatch)" : "", i.enabled === false ? "(off)" : "", i.children ? "›" : ""].filter(Boolean).join(" ")),
    ...(i.children ? render(i.children, depth + 1) : []),
  ]);

const ext = { name: "Dark Reader", enabled: true, pinned: false, optionsUrl: "chrome-extension://x/options.html", sidePanel: false, mayModify: true };

test("an extension's menu: its name, Options and Pin, Turn Off and Manage Extension, Remove Extension… last", () => {
  assert.deepEqual(render(extensionMenuItems(ext, false)), [
    "Dark Reader (off)",
    "---",
    "Options [gearshape]",
    "Pin to Toolbar [pin]",
    "---",
    "Turn Off [power]",
    "Manage Extension [puzzlepiece.extension]",
    "---",
    "Remove Extension… [trash]",
  ]);
  assert.deepEqual(render(extensionMenuItems({ ...ext, pinned: true, sidePanel: true, mayModify: false }, true)).slice(2, 5), [
    "Options [gearshape]",
    "Close Side Panel [sidebar.right]",
    "Unpin from Toolbar [pin.slash]",
  ]);
  const off = render(extensionMenuItems({ ...ext, enabled: false, sidePanel: true }, false));
  assert.deepEqual(off.slice(2, 4), ["Options [gearshape] (off)", "Pin to Toolbar [pin]"]);
  assert.equal(off[5], "Turn On [power]");
});

const { windowExtensions, pageProfile } = await import("./store.ts");
const { openOptions } = await import("./actions.ts");

function privateSetup() {
  S().hydrate({});
  const regular = S().createWindow({ url: "a.com" });
  const priv = S().createWindow({ kind: "private", url: "b.com" });
  const spanning = { ...EXT, id: "spanning", incognito: true, incognitoSplit: false, optionsUrl: "chrome-extension://spanning/options.html" };
  const split = { ...EXT, id: "split", incognito: true, incognitoSplit: true, optionsUrl: "chrome-extension://split/options.html" };
  const list = [spanning, split, { ...EXT, id: "kept-out" }, { ...EXT, id: "turned-off", incognito: true, enabled: false }];
  useExtensions.setState({ lists: { "": list }, actions: {}, popup: null, sidePanels: {} });
  const urls = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url);
  return { regular, priv, spanning, split, urls };
}

test("a private window shows the extensions allowed in incognito, spanning ones too (#909)", () => {
  const { regular, priv } = privateSetup();
  assert.deepEqual(windowExtensions(S(), priv).map((x) => x.id), ["spanning", "split"]);
  assert.deepEqual(windowExtensions(S(), regular).map((x) => x.id), ["spanning", "split", "kept-out"]);
  assert.equal(pageProfile(S(), priv), `incognito:${priv}@`, "Chrome picks the popup's profile from the private window's Browser");
});

test("Options from a private window: a spanning extension's page opens in its profile's regular window, as in Chrome", () => {
  const { regular, priv, spanning, split, urls } = privateSetup();
  openOptions(priv, split);
  assert.deepEqual(urls(priv).slice(1), [split.optionsUrl], "a split extension's page loads privately");
  openOptions(priv, spanning);
  assert.ok(!urls(priv).includes(spanning.optionsUrl), "a spanning extension's page can't load in incognito");
  assert.deepEqual(urls(regular).slice(1), [spanning.optionsUrl]);

  S().closeWindow(regular);
  const before = new Set(S().windowOrder);
  openOptions(priv, spanning);
  const made = S().windowOrder.filter((id) => !before.has(id));
  assert.equal(made.length, 1, "with no regular window of the profile open, one opens");
  assert.equal(S().windows[made[0]].kind, "main");
  assert.deepEqual(urls(made[0]), [spanning.optionsUrl]);
});

test("with several profiles, a private window lists and opens only its own profile's extensions", () => {
  S().hydrate({});
  const personal = S().createWindow({ url: "a.com" });
  const workId = S().createProfile({ name: "Work" });
  const work = S().createWindow({ profileId: workId, url: "b.com" });
  const privPersonal = S().createWindow({ kind: "private", profileId: "default", url: "c.com" });
  const privWork = S().createWindow({ kind: "private", profileId: workId, url: "d.com" });
  const shared = { ...EXT, id: "shared", incognito: true, optionsUrl: "chrome-extension://shared/options.html" };
  useExtensions.setState({
    lists: { "": [{ ...shared, incognito: false }, { ...EXT, id: "only-personal", incognito: true }], [workId]: [shared, { ...EXT, id: "only-work", incognito: true }] },
    actions: {}, popup: null, sidePanels: {},
  });
  assert.deepEqual(windowExtensions(S(), privPersonal).map((x) => x.id), ["only-personal"], "the same extension, allowed in Work alone");
  assert.deepEqual(windowExtensions(S(), privWork).map((x) => x.id), ["shared", "only-work"]);
  assert.equal(pageProfile(S(), privWork), `incognito:${privWork}@${workId}`);

  S().setFocusedWindow(personal);
  S().setFocusedWindow(privWork);
  openOptions(privWork, shared);
  const urls = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url);
  assert.deepEqual(urls(work).slice(1), [shared.optionsUrl], "Work's regular window, though Personal's was used last");
  assert.ok(!urls(personal).includes(shared.optionsUrl) && !urls(privWork).includes(shared.optionsUrl));
});
