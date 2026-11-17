import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
const { useBrowser } = await import("./store.ts");
const { changedIds } = await import("./changes.ts");
const { livePinTables } = await import("../pins/pinChoices.ts");
const { mirrorPins } = await import("../pins/pinMirror.ts");
const { settlePinHomes } = await import("../pins/pinHomes.ts");
const { settleShownTabs } = await import("../groups/shownTabs.ts");

const S = () => useBrowser.getState();

function session(second = true) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const ids = [S().windows[w].tabIds[0]];
  for (let i = 0; i < 40; i++) ids.push(S().newTab(w, { url: `https://site${i}.com/`, background: true }));
  S().pinTabs(ids.slice(1, 6), true);
  const group = S().createGroup(ids.slice(10, 14));
  S().updateGroup(group, { collapsed: true });
  if (second) S().createWindow({ url: "https://b.com/" });
  return { w, ids };
}

function counted(map) {
  const seen = { enumerations: 0 };
  const proxy = new Proxy(map, { ownKeys: (target) => (seen.enumerations++, Reflect.ownKeys(target)) });
  return { proxy, seen };
}

function enumerationsOf(step, next, prev) {
  const tabs = counted(next.tabs);
  const windows = counted(next.windows);
  const s = { ...next, tabs: tabs.proxy, windows: windows.proxy };
  changedIds(s.tabs, prev.tabs);
  changedIds(s.windows, prev.windows);
  tabs.seen.enumerations = 0;
  windows.seen.enumerations = 0;
  step(s, prev);
  return tabs.seen.enumerations;
}

const STEPS = { livePinTables, mirrorPins, settlePinHomes, settleShownTabs };

test("a title change, or a tab switch, makes no settle step list every tab", () => {
  const { w, ids } = session();
  useBrowser.setState({ pinChoices: { [S().windows[w].profileId]: { [ids[2]]: "kept" } } });
  const prev = S();
  const titled = { ...prev, tabs: { ...prev.tabs, [ids[2]]: { ...prev.tabs[ids[2]], title: "Inbox (3)" } } };
  const switched = { ...prev, windows: { ...prev.windows, [w]: { ...prev.windows[w], activeTabIds: { ...prev.windows[w].activeTabIds, [prev.windows[w].profileId]: ids[20] } } } };
  for (const [name, step] of Object.entries(STEPS)) {
    assert.equal(enumerationsOf(step, titled, prev), 0, `${name} listed every tab for a title change`);
    assert.equal(enumerationsOf(step, switched, prev), 0, `${name} listed every tab for a tab switch`);
  }
});

test("the guarded steps still act when what they read changes", () => {
  const { w, ids } = session(false);
  const profile = S().windows[w].profileId;
  useBrowser.setState({ pinChoices: { [profile]: { [ids[2]]: "kept", [ids[3]]: "kept too" } } });
  const prev = S();
  const unpinned = { ...prev, tabs: { ...prev.tabs, [ids[2]]: { ...prev.tabs[ids[2]], pin: null } } };
  assert.notEqual(livePinTables(unpinned, prev), null, "unpinning prunes the pin tables");
  const reordered = { ...prev, windows: { ...prev.windows, [w]: { ...prev.windows[w], tabIds: [...prev.windows[w].tabIds].reverse() } } };
  assert.ok(mirrorPins(reordered, prev) !== undefined);
  const homeless = { ...prev, tabs: { ...prev.tabs, [ids[4]]: { ...prev.tabs[ids[4]], pinnedUrl: null } } };
  assert.notEqual(settlePinHomes(homeless, prev), null, "a pinned tab without a home gets one");
});
