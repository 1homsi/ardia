import { emitNativeEvent } from "../events";
import { takerOfOpenedTab } from "./openedTabs";
import { isPopupWindowId } from "./popupWindows";
import { isPrivateName } from "./privateWindows";

type Listener = (name: string, data: unknown) => void;

export type RequestPage = { key: string; profile: string; windowId: string; closed: boolean; listeners: Set<Listener> };

export const BROWSER_WINDOW_WAIT_MS = 10000;

type Waiting = { profile: string | undefined; deliver: (host: RequestPage) => void; timer: ReturnType<typeof setTimeout> };

const waiting = new Set<Waiting>();

const listens = (page: RequestPage | undefined): page is RequestPage => !!page && page.listeners.size > 0 && !page.closed && !isPopupWindowId(page.windowId);

export const listeningBrowserPages = <Page extends RequestPage>(all: Iterable<Page>): Page[] => [...all].filter(listens);

export function requestHost<Page extends RequestPage>(opener: Page | undefined, profile: string | undefined, all: Iterable<Page>): Page | undefined {
  if (listens(opener)) return opener;
  return takerOfOpenedTab(listeningBrowserPages(all), profile);
}

export function hostInNewBrowserWindow(profile: string | undefined, deliver: (host: RequestPage) => void, giveUp: () => void) {
  if (profile !== undefined && isPrivateName(profile)) return giveUp();
  const entry: Waiting = {
    profile,
    deliver,
    timer: setTimeout(() => {
      waiting.delete(entry);
      giveUp();
    }, BROWSER_WINDOW_WAIT_MS),
  };
  waiting.add(entry);
  emitNativeEvent("ArdiaShell", "onAppEvent", { type: "reopen" });
}

export function browserPagesListening(all: Iterable<RequestPage>) {
  if (!waiting.size) return;
  const listening = listeningBrowserPages(all);
  for (const entry of [...waiting]) {
    const host = takerOfOpenedTab(listening, entry.profile);
    if (!host) continue;
    clearTimeout(entry.timer);
    waiting.delete(entry);
    entry.deliver(host);
  }
}
