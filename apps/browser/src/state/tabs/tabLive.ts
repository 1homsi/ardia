import { changedIds } from "../browser/changes";
import { IDLE_LIVE, merge } from "../browser/model";
import type { BrowserState } from "../browser/store";
import type { Tab, TabLive } from "../browser/types";
import { frozenCopiesOf } from "../pins/pinShare";
import { hasPage, holderOfPage, isAsleep, navigationOf } from "./pageSession";

export type LiveListener = (tabId: string, live: TabLive, prev: TabLive) => void;
type Browser = { getState(): BrowserState; subscribe(listener: (s: BrowserState, prev: BrowserState) => void): () => void };

const values = new Map<string, TabLive>();
const watchers = new Map<string, Set<() => void>>();
const listeners = new Set<LiveListener>();
let browser: Browser | null = null;

export const liveOf = (tabId: string): TabLive => values.get(tabId) ?? IDLE_LIVE;

export const shownLiveOf = (s: Pick<BrowserState, "tabs">, tabId: string): TabLive => liveOf(holderOfPage(s.tabs[tabId]) ?? tabId);

export const liveReachOf = (s: Pick<BrowserState, "tabs">, tabId: string): string[] => [tabId, ...frozenCopiesOf(s, tabId).map((t) => t.id)];

export function replaceLive(tabId: string, next: TabLive) {
  const prev = liveOf(tabId);
  if (next === prev) return;
  if (next === IDLE_LIVE) values.delete(tabId);
  else values.set(tabId, next);
  for (const id of browser ? liveReachOf(browser.getState(), tabId) : [tabId]) {
    const woken = watchers.get(id);
    if (woken) for (const listener of [...woken]) listener();
  }
  for (const listener of [...listeners]) listener(tabId, next, prev);
}

export function setLive(tabId: string, patch: Partial<TabLive>) {
  if (browser?.getState().tabs[tabId]) replaceLive(tabId, merge(liveOf(tabId), patch));
}

export function forgetLive(ids: Iterable<string>) {
  for (const id of ids) if (values.has(id)) replaceLive(id, IDLE_LIVE);
}

export const forgetAllLive = () => forgetLive([...values.keys()]);

const reloadedElsewhere = (tab: Tab, was: Tab) =>
  (tab.windowId !== was.windowId || tab.profileId !== was.profileId) && navigationOf(tab)?.seq !== navigationOf(was)?.seq;

export function bindLiveToBrowser(store: Browser) {
  browser = store;
  store.subscribe((s, prev) => {
    if (s.tabs === prev.tabs || !values.size) return;
    const gone: string[] = [];
    for (const id of changedIds(s.tabs, prev.tabs)) {
      const tab = s.tabs[id];
      const was = prev.tabs[id];
      const heldBy = holderOfPage(was);
      if (!tab || (isAsleep(tab) && !isAsleep(was)) || (was && reloadedElsewhere(tab, was))) gone.push(id);
      else if (heldBy && hasPage(tab)) replaceLive(id, liveOf(heldBy));
    }
    forgetLive(gone);
  });
}

export function watchLive(tabId: string, listener: () => void): () => void {
  let woken = watchers.get(tabId);
  if (!woken) watchers.set(tabId, (woken = new Set()));
  woken.add(listener);
  return () => {
    woken.delete(listener);
    if (!woken.size && watchers.get(tabId) === woken) watchers.delete(tabId);
  };
}

export function onLiveChange(listener: LiveListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
