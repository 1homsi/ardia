import { extensionSidePanelUrl } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { shownPageId } from "../peek/peek";
import { noteSidePanelKept } from "../telemetry/usage";
import { shownReadyTab, extensionPageUrl, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions, type SidePanel } from "./store";

const wanted = new Map<string, string>();
const fetches = new Map<string, number>();
const openings = new Map<string, number>();
const focusOwed = new Map<string, { opened: number; page: string | undefined }>();
let lastOpening = 0;
const shownTabs = new Map<string, Set<string>>();
const closedTabs = new Map<string, Set<string>>();
const removedTabs = new Map<string, Set<string>>();

const tabsOf = (tabs: Map<string, Set<string>>, windowId: string) => {
  let set = tabs.get(windowId);
  if (!set) tabs.set(windowId, (set = new Set()));
  return set;
};

const nextFetch = (windowId: string) => {
  const ticket = (fetches.get(windowId) ?? 0) + 1;
  fetches.set(windowId, ticket);
  return ticket;
};

export const wantedSidePanels = () => [...wanted];

export const panelTabOpen = (windowId: string, tabId?: string) => !tabId || useBrowser.getState().tabs[tabId]?.windowId === windowId;

export const panelClosedOnTab = (windowId: string, tabId?: string) => !!tabId && !!closedTabs.get(windowId)?.has(tabId);

export const panelDroppedOnTab = (windowId: string, tabId?: string) => panelClosedOnTab(windowId, tabId) || (!!tabId && !!removedTabs.get(windowId)?.has(tabId));

const sameCard = (a: SidePanel, b: SidePanel) => a.extensionId === b.extensionId && a.pageProfile === b.pageProfile && a.url === b.url && a.opened === b.opened;

export function takeSidePanelFocus(windowId: string, panel: SidePanel): boolean {
  const owed = focusOwed.get(windowId);
  const { sidePanels, sidePanelLookups } = useExtensions.getState();
  const now = sidePanels[windowId];
  if (owed?.opened !== panel.opened || sidePanelLookups[windowId] || !now || !sameCard(now, panel)) return false;
  focusOwed.delete(windowId);
  return owed.page === shownPageId(useBrowser.getState(), windowId);
}

function countLookup(windowId: string, by: number) {
  useExtensions.setState((e) => {
    const sidePanelLookups = { ...e.sidePanelLookups };
    const left = (sidePanelLookups[windowId] ?? 0) + by;
    if (left > 0) sidePanelLookups[windowId] = left;
    else delete sidePanelLookups[windowId];
    return { sidePanelLookups };
  });
}

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  const reopening = wanted.get(windowId) !== extensionId;
  if (reopening) {
    shownTabs.delete(windowId);
    closedTabs.delete(windowId);
    removedTabs.delete(windowId);
  }
  if (reopening || useExtensions.getState().sidePanels[windowId]?.hidden) {
    lastOpening += 1;
    openings.set(windowId, lastOpening);
    focusOwed.set(windowId, { opened: lastOpening, page: shownPageId(useBrowser.getState(), windowId) });
  }
  wanted.set(windowId, extensionId);
  const tab = shownPageId(useBrowser.getState(), windowId);
  if (tab) closedTabs.get(windowId)?.delete(tab);
  refreshSidePanelCards(windowId);
  return syncSidePanel(windowId);
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const id = wanted.get(windowId);
  if (!id || (extensionId && id !== extensionId)) return;
  wanted.delete(windowId);
  shownTabs.delete(windowId);
  closedTabs.delete(windowId);
  removedTabs.delete(windowId);
  openings.delete(windowId);
  focusOwed.delete(windowId);
  nextFetch(windowId);
  if (useExtensions.getState().sidePanels[windowId])
    useExtensions.setState((e) => {
      const sidePanels = { ...e.sidePanels };
      delete sidePanels[windowId];
      return { sidePanels };
    });
  refreshSidePanelCards(windowId);
}

function hideSidePanel(windowId: string) {
  const now = useExtensions.getState().sidePanels[windowId];
  if (!now) return closeSidePanel(windowId);
  if (!now.hidden) useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: { ...now, hidden: true } } }));
  refreshSidePanelCards(windowId);
}

export function closeSidePanelOnTab(windowId: string, ownerTabId?: string): boolean {
  const shownTab = shownPageId(useBrowser.getState(), windowId) ?? useExtensions.getState().sidePanels[windowId]?.tabId;
  const tabId = ownerTabId ?? shownTab;
  if (!tabId) {
    closeSidePanel(windowId);
    return true;
  }
  shownTabs.get(windowId)?.delete(tabId);
  tabsOf(closedTabs, windowId).add(tabId);
  if (tabId !== shownTab) {
    const entry = useExtensions.getState().sidePanels[windowId];
    if (entry && !entry.hidden && entry.tabId === tabId) {
      hideSidePanel(windowId);
      return false;
    }
    refreshSidePanelCards(windowId);
    return false;
  }
  const others = [...(shownTabs.get(windowId) ?? [])].some((id) => panelTabOpen(windowId, id));
  if (!others) closeSidePanel(windowId);
  else {
    nextFetch(windowId);
    hideSidePanel(windowId);
  }
  return true;
}

export function toggleSidePanel(windowId: string, extensionId: string): Promise<void> | void {
  const shown = useExtensions.getState().sidePanels[windowId];
  if (wanted.get(windowId) === extensionId && !shown?.hidden) closeSidePanelOnTab(windowId);
  else return openSidePanel(windowId, extensionId);
}

export function closeSidePanelsOf(extensionId: string) {
  for (const [windowId, id] of wanted) if (id === extensionId) closeSidePanel(windowId);
}

export async function syncSidePanel(windowId: string): Promise<void> {
  const extensionId = wanted.get(windowId);
  if (!extensionId) return;
  if (focusOwed.get(windowId)?.page !== shownPageId(useBrowser.getState(), windowId)) focusOwed.delete(windowId);
  countLookup(windowId, 1);
  try {
    await showSidePanel(windowId, extensionId);
  } finally {
    countLookup(windowId, -1);
  }
}

async function showSidePanel(windowId: string, extensionId: string): Promise<void> {
  const ticket = nextFetch(windowId);
  const readyTab = shownReadyTab(windowId);
  const shown = useExtensions.getState().sidePanels[windowId];
  if (!readyTab && shown?.extensionId === extensionId) return;
  if (panelClosedOnTab(windowId, readyTab)) return hideSidePanel(windowId);
  const ext = shownIn(windowId, extensionId);
  const url = !ext
    ? null
    : readyTab
      ? await extensionSidePanelUrl(readyTab, extensionId)
      : !isPrivate(useBrowser.getState(), windowId) && ext.sidePanel
        ? extensionPageUrl(extensionId, ext.sidePanel)
        : null;
  if (fetches.get(windowId) !== ticket) return;
  if (!shownIn(windowId, extensionId)) return closeSidePanel(windowId);
  if (!url && readyTab && shownTabs.get(windowId)?.delete(readyTab)) tabsOf(removedTabs, windowId).add(readyTab);
  if (!url) return readyTab ? hideSidePanel(windowId) : closeSidePanel(windowId);
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url, opened: openings.get(windowId) ?? 0, tabId: readyTab };
  if (readyTab) {
    if (shownTabs.get(windowId)?.has(readyTab) && useExtensions.getState().sidePanels[windowId]?.tabId !== readyTab) noteSidePanelKept();
    tabsOf(shownTabs, windowId).add(readyTab);
    removedTabs.get(windowId)?.delete(readyTab);
  }
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile && now.opened === panel.opened && now.tabId === panel.tabId && !now.hidden) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
  refreshSidePanelCards(windowId);
}

export const panelKey = (p: SidePanel) => `${p.extensionId}|${p.pageProfile}|${p.url}`;

const NO_CARDS: SidePanel[] = [];

function cardKept(windowId: string, card: SidePanel, shown: SidePanel | undefined): boolean {
  if (shown && !shown.hidden && card.tabId === shown.tabId) return panelKey(card) === panelKey(shown);
  return !!card.tabId && wanted.get(windowId) === card.extensionId && panelTabOpen(windowId, card.tabId) && !panelDroppedOnTab(windowId, card.tabId);
}

function setCards(windowId: string, cards: SidePanel[]) {
  useExtensions.setState((e) => {
    const sidePanelCards = { ...e.sidePanelCards };
    if (cards.length) sidePanelCards[windowId] = cards;
    else delete sidePanelCards[windowId];
    return { sidePanelCards };
  });
}

export const sidePanelCards = (windowId: string) => useExtensions.getState().sidePanelCards[windowId] ?? NO_CARDS;

export function refreshSidePanelCards(windowId: string) {
  const shown = useExtensions.getState().sidePanels[windowId];
  const before = sidePanelCards(windowId);
  let next = before.filter((card) => cardKept(windowId, card, shown));
  if (shown && !shown.hidden) {
    const at = next.findIndex((card) => panelKey(card) === panelKey(shown));
    next = at < 0 ? [...next, shown] : next.map((card, i) => (i === at ? shown : card));
  }
  if (next.length !== before.length || next.some((card, i) => card !== before[i])) setCards(windowId, next);
}

export function settleSidePanelTabs(windowId: string) {
  const entry = useExtensions.getState().sidePanels[windowId];
  if (entry && !entry.hidden && entry.tabId && !panelTabOpen(windowId, entry.tabId)) return hideSidePanel(windowId);
  refreshSidePanelCards(windowId);
}

export function watchSidePanelCards(): () => void {
  return useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows) return;
    const { sidePanels, sidePanelCards: cards } = useExtensions.getState();
    for (const windowId of new Set([...Object.keys(cards), ...Object.keys(sidePanels)])) settleSidePanelTabs(windowId);
  });
}

const sameTabCard = (a: SidePanel, b: SidePanel) => panelKey(a) === panelKey(b) && a.tabId === b.tabId;

export function closePanelCard(windowId: string, card: SidePanel) {
  const live = sidePanelCards(windowId).find((c) => sameTabCard(c, card));
  if (!live) return;
  if (wanted.get(windowId) !== card.extensionId) {
    const entry = useExtensions.getState().sidePanels[windowId];
    if (entry && !entry.hidden && sameTabCard(entry, card)) hideSidePanel(windowId);
    return dropSidePanelCard(windowId, live);
  }
  if (!card.tabId) return closeSidePanel(windowId, card.extensionId);
  closeSidePanelOnTab(windowId, card.tabId);
}

export function dropSidePanelCard(windowId: string, card: SidePanel) {
  const before = sidePanelCards(windowId);
  const after = before.filter((c) => !sameTabCard(c, card));
  if (after.length !== before.length) setCards(windowId, after);
}
