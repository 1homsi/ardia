import type { LinkRoute } from "@ardia/ardiacore";
import { emitWhenListened } from "../events";
import { takerOfOpenedTab } from "./openedTabs";
import type { PageListener } from "./pages";
import { isPopupWindowId } from "./popupWindows";
import { isPrivateName } from "./privateWindows";

export type RequestPage = { key: string; profile: string; windowId: string; closed: boolean; listeners: Set<PageListener> };

export const BROWSER_WINDOW_WAIT_MS = 10000;

type LinkTab = { url: string; profile: string; adoptId: string | undefined; giveUp: () => void; timer: ReturnType<typeof setTimeout> };

const unrouted: LinkTab[] = [];
const unadopted = new Map<string, LinkTab>();

const listens = (page: RequestPage | undefined): page is RequestPage => !!page && page.listeners.size > 0 && !page.closed && !isPopupWindowId(page.windowId);

export const listeningBrowserPages = <Page extends RequestPage>(all: Iterable<Page>): Page[] => [...all].filter(listens);

export function requestHost<Page extends RequestPage>(opener: Page | undefined, profile: string | undefined, all: Iterable<Page>): Page | undefined {
  if (listens(opener)) return opener;
  return takerOfOpenedTab(listeningBrowserPages(all), profile);
}

function forget(entry: LinkTab) {
  clearTimeout(entry.timer);
  const at = unrouted.indexOf(entry);
  if (at >= 0) unrouted.splice(at, 1);
  if (entry.adoptId !== undefined && unadopted.get(entry.adoptId) === entry) unadopted.delete(entry.adoptId);
}

export function openInBrowserWindow(profile: string, url: string, adoptId: string | undefined, giveUp: () => void) {
  if (isPrivateName(profile)) return giveUp();
  const entry: LinkTab = { url, profile, adoptId, giveUp, timer: setTimeout(() => (forget(entry), entry.giveUp()), BROWSER_WINDOW_WAIT_MS) };
  unrouted.push(entry);
  if (adoptId !== undefined) unadopted.set(adoptId, entry);
  emitWhenListened("ArdiaShell", "onOpenURLs", { urls: [url] });
}

export function routeLinkTabs(urls: readonly string[]): LinkRoute {
  let profile: string | undefined;
  const adoptIds = urls.map((url) => {
    const entry = unrouted.find((each) => each.url === url && (profile === undefined || each.profile === profile));
    if (!entry) return null;
    unrouted.splice(unrouted.indexOf(entry), 1);
    profile ??= entry.profile;
    if (entry.adoptId === undefined) clearTimeout(entry.timer);
    return entry.adoptId ?? null;
  });
  return profile === undefined ? {} : { profile, adoptIds };
}

export function linkTabAdopted(adoptId: string | undefined) {
  const entry = adoptId === undefined ? undefined : unadopted.get(adoptId);
  if (entry) forget(entry);
}
