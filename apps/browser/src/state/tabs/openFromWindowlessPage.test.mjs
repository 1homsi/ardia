import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { setLinkGate } = await import("../littleArdia/linkGate.ts");
const { openFromWindowlessPage } = await import("./openFromWindowlessPage.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const WORK = { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 };
const URL = "https://help.example/";
const offered = (adoptId, disposition = "foreground") => ({ url: URL, disposition, adoptId, userGesture: true, profile: "work" });

let gateAsked = 0;
setLinkGate(() => {
  gateAsked += 1;
  return { url: URL, route: { profileId: "default", open: "window", windowId: null }, decided: true };
});

beforeEach(() => {
  for (const id of [...S().windowOrder]) S().closeWindow(id);
  S().hydrate({ profiles: { default: PERSONAL, work: WORK }, profileOrder: ["default", "work"] });
  stub.discardedOffers.length = 0;
  stub.windows.focused = null;
  gateAsked = 0;
});

const regularWindows = () => S().windowOrder.filter((id) => S().windows[id]?.kind === "main");
const adoptedTab = (adoptId) => Object.values(S().tabs).find((t) => t.page?.kind === "adopted" && t.page.adopt === adoptId);

test("a lone pop-up's tab goes to the profile's browser window that shows a page, with its offered tab, and the window comes forward", () => {
  const w = S().createWindow({ url: "https://work.example/", profileId: "work" });
  openFromWindowlessPage(offered("ardiacore:1"), "work");
  const tab = adoptedTab("ardiacore:1");
  assert.equal(tab?.windowId, w, "it is a tab of the work window");
  assert.equal(tab?.profileId, "work");
  assert.equal(regularWindows().length, 1, "no window is opened for it");
  assert.equal(stub.windows.focused, w);
  assert.equal(gateAsked, 0, "no external-link rule is asked");
});

test("a lone pop-up's tab goes to an empty browser window of its profile, New Tab as the command bar", () => {
  S().updateSettings({ newTabOpens: "commandBar" });
  const w = S().createWindow({ profileId: "work" });
  const before = S().windows[w].tabIds.length;
  openFromWindowlessPage(offered("ardiacore:2"), "work");
  assert.equal(adoptedTab("ardiacore:2")?.windowId, w);
  assert.equal(S().windows[w].tabIds.length, before + 1);
  assert.equal(regularWindows().length, 1);
  S().updateSettings({ newTabOpens: "newTab" });
});

test("a lone pop-up's tab of the second profile goes to that profile's window, not the frontmost window of the first", () => {
  const work = S().createWindow({ url: "https://work.example/", profileId: "work" });
  const personal = S().createWindow({ url: "https://home.example/", profileId: "default" });
  S().setFocusedWindow(personal);
  openFromWindowlessPage(offered("ardiacore:3"), "work");
  assert.equal(adoptedTab("ardiacore:3")?.windowId, work);
  assert.equal(S().windows[personal].tabIds.length, 1, "the personal window gets nothing");
});

test("with only another profile's window open, a lone pop-up's tab opens a window of its own profile holding the offered tab", () => {
  const personal = S().createWindow({ url: "https://home.example/", profileId: "default" });
  openFromWindowlessPage(offered("ardiacore:4"), "work");
  const tab = adoptedTab("ardiacore:4");
  assert.ok(tab && tab.windowId !== personal, "a new window");
  assert.equal(S().windows[tab.windowId].profileId, "work");
  assert.equal(tab.profileId, "work");
  assert.equal(S().windows[personal].tabIds.length, 1);
});

test("with no browser window, a lone pop-up's tab opens a window of its profile holding the offered tab, and a link rule doesn't apply", () => {
  openFromWindowlessPage(offered("ardiacore:5"), "work");
  const tab = adoptedTab("ardiacore:5");
  assert.equal(S().windows[tab?.windowId]?.profileId, "work");
  assert.equal(gateAsked, 0);
  assert.deepEqual(stub.discardedOffers, []);
});

test("a background tab from a lone pop-up goes to the window without bringing it forward", () => {
  const w = S().createWindow({ url: "https://work.example/", profileId: "work" });
  stub.windows.focused = null;
  openFromWindowlessPage(offered("ardiacore:6", "background"), "work");
  assert.equal(adoptedTab("ardiacore:6")?.windowId, w);
  assert.equal(stub.windows.focused, null);
});

test("a link a lone pop-up opens in a new window opens a window of its profile with that address", () => {
  S().createWindow({ url: "https://work.example/", profileId: "work" });
  openFromWindowlessPage({ url: URL, disposition: "window", userGesture: true }, "work");
  const opened = regularWindows().map((id) => S().windows[id]).find((w) => w.tabIds.some((t) => S().tabs[t].url === URL || S().tabs[t].page?.nav?.url === URL));
  assert.equal(regularWindows().length, 2);
  assert.equal(opened?.profileId, "work");
  assert.equal(gateAsked, 0);
});

test("a lone pop-up's tab of a profile the app doesn't know is closed in the engine at once", () => {
  openFromWindowlessPage({ ...offered("ardiacore:7"), profile: "gone" }, "gone");
  assert.deepEqual(stub.discardedOffers, ["ardiacore:7"]);
  assert.equal(regularWindows().length, 0);
});

test("a link a lone pop-up opens in a new tab, with no offered tab, goes to the profile's window as a new tab with that address", () => {
  const w = S().createWindow({ url: "https://work.example/", profileId: "work" });
  openFromWindowlessPage({ url: URL, disposition: "foreground", userGesture: true }, "work");
  const tab = Object.values(S().tabs).find((t) => t.windowId === w && (t.url === URL || t.page?.nav?.url === URL));
  assert.equal(tab?.profileId, "work");
  assert.equal(regularWindows().length, 1);
  assert.equal(gateAsked, 0);
});

test("a link a lone pop-up opens in a private window opens a private window of its profile, and an offered tab of the regular profile is closed rather than moved into it", () => {
  openFromWindowlessPage({ ...offered("ardiacore:8"), disposition: "incognito" }, "work");
  const privateWindow = S().windowOrder.map((id) => S().windows[id]).find((w) => w?.kind === "private");
  assert.ok(privateWindow, "a private window opens");
  assert.deepEqual(stub.discardedOffers, ["ardiacore:8"]);
});
