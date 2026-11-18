import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { engineProfile, IDLE_LIVE, viewTabIds } = await import("../browser/model.ts");
const { useTabLive } = await import("../browser/hooks.ts");
const { liveOf, shownLiveOf } = await import("./tabLive.ts");
const { watchTabState } = await import("./tabStateWatch.ts");
const { chromeChanged } = await import("./liveTabs.ts");
const { LOADING, PLAYING, rowFlags } = await import("../sidebar/rowState.ts");

const S = () => useBrowser.getState();

function pinnedInTwoWindows() {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.com" });
  const copy = viewTabIds(S(), b).find((id) => S().tabs[id].pinnedUrl === "https://mail.com");
  S().activate(copy);
  return { a, b, mail, copy };
}

test("a live update writes nothing to the main store and wakes none of its subscribers", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const [tab] = S().windows[w].tabIds;
  const before = S();
  let heard = 0;
  const off = useBrowser.subscribe(() => heard++);
  S().updateLive(tab, { isLoading: true, canGoBack: true, themeColor: "#123456" });
  S().updateTab(tab, {}, { playingAudio: true });
  off();
  assert.equal(S(), before, "the state root is the same object");
  assert.equal(heard, 0);
  assert.deepEqual(liveOf(tab), { ...IDLE_LIVE, isLoading: true, canGoBack: true, themeColor: "#123456", playingAudio: true });
  S().updateLive("no-such-tab", { isLoading: true });
  assert.equal(liveOf("no-such-tab"), IDLE_LIVE, "a tab the store doesn't know reports nothing");
});

test("a frozen copy's row shows its holder's loading and sound, and its watchers wake when they change", () => {
  const { a, mail, copy } = pinnedInTwoWindows();
  assert.equal(S().tabs[copy].page.holderId, mail);
  const woken = [];
  const off = watchTabState(copy, () => woken.push(copy));
  S().updateLive(mail, { isLoading: true });
  assert.equal(woken.length, 1, "the copy's row woke for its holder's load");
  assert.ok(rowFlags(S(), a, copy) & LOADING);
  S().updateLive(mail, { playingAudio: true, isLoading: false });
  assert.equal(woken.length, 2);
  assert.ok(rowFlags(S(), a, copy) & PLAYING);
  assert.ok(!(rowFlags(S(), a, copy) & LOADING));
  assert.equal(liveOf(copy), IDLE_LIVE, "nothing is copied into the copy's own entry");
  assert.equal(shownLiveOf(S(), copy), liveOf(mail));
  off();
});

test("useTabLive follows a tab and, for a frozen copy, its holder", () => {
  const { a, mail, copy } = pinnedInTwoWindows();
  const own = mount(() => useTabLive(mail, (l) => l.isLoading));
  const shown = mount(() => useTabLive(copy, (l) => l.playingAudio));
  S().updateLive(mail, { isLoading: true, playingAudio: true });
  assert.equal(own.value, true);
  assert.equal(shown.value, true);
  S().activate(copy);
  assert.equal(S().tabs[mail].windowId, a, "the page came back to A");
  assert.equal(S().tabs[copy].page.holderId, mail);
  S().updateLive(mail, { playingAudio: false });
  assert.equal(shown.value, false);
  own.unmount();
  shown.unmount();
});

test("a closed tab's live state is forgotten; a tab Chrome moves between windows keeps it, one Ardia reloads elsewhere starts over", () => {
  S().hydrate({});
  const w1 = S().createWindow({ url: "https://a.com" });
  const [a] = S().windows[w1].tabIds;
  const w2 = S().createWindow({ url: "https://b.com" });
  const [b] = S().windows[w2].tabIds;
  const c = S().newTab(w2, { url: "https://c.com", background: true });
  const d = S().newTab(w2, { url: "https://d.com", background: true });
  for (const id of [a, b, c, d]) S().updateLive(id, { playingAudio: true, canGoBack: true });

  S().closeTab(d);
  assert.equal(liveOf(d), IDLE_LIVE);

  const before = { strip: 1, window: 1, profile: engineProfile(S(), "default"), tabs: [{ key: a, browser: 1, index: 0, active: true, pinned: false }] };
  const after = { ...before, tabs: [...before.tabs, { key: b, browser: 2, index: 1, active: false, pinned: false }] };
  useBrowser.setState(chromeChanged(S(), before, after, { seen: new Set([a, b, c]) }));
  assert.equal(S().tabs[b].windowId, w1, "Chrome dragged b into the first window");
  assert.equal(liveOf(b).playingAudio, true, "the same page keeps playing");

  S().moveTabsToWindow([c], w1);
  assert.equal(S().tabs[c].windowId, w1);
  assert.equal(liveOf(c), IDLE_LIVE, "a move that reloads the page starts from idle");
  assert.equal(liveOf(a).canGoBack, true);
});
