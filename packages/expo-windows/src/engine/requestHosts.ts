import type { OpenWindowRequest, WindowRequest } from "@ardia/ardiacore";
import { emitWhenListened } from "../events";
import { takerOfOpenedTab } from "./openedTabs";
import type { Page } from "./pages";
import { isPopupWindowId } from "./popupWindows";
import { isPrivateName } from "./privateWindows";

export type RequestPage = Pick<Page, "key" | "profile" | "windowId" | "closed" | "listeners">;

export const BROWSER_WINDOW_WAIT_MS = 10000;

const unadopted = new Map<string, ReturnType<typeof setTimeout>>();

const listens = (page: RequestPage | undefined): page is RequestPage => !!page && page.listeners.size > 0 && !page.closed && !isPopupWindowId(page.windowId);

export const listeningBrowserPages = <Candidate extends RequestPage>(all: Iterable<Candidate>): Candidate[] => [...all].filter(listens);

export function requestHost<Candidate extends RequestPage>(opener: Candidate | undefined, profile: string | undefined, all: Iterable<Candidate>): Candidate | undefined {
  if (listens(opener)) return opener;
  return takerOfOpenedTab(listeningBrowserPages(all), profile);
}

export const asOpenWindowRequest = (value: unknown): OpenWindowRequest | null =>
  typeof value === "object" && value !== null && typeof (value as OpenWindowRequest).url === "string" ? (value as OpenWindowRequest) : null;

export function openInBrowserWindow(request: OpenWindowRequest, profile: string, giveUp: () => void) {
  if (isPrivateName(profile)) return giveUp();
  const { adoptId } = request;
  if (adoptId) {
    clearTimeout(unadopted.get(adoptId));
    unadopted.set(
      adoptId,
      setTimeout(() => {
        unadopted.delete(adoptId);
        giveUp();
      }, BROWSER_WINDOW_WAIT_MS),
    );
  }
  emitWhenListened("ArdiaTabs", "tabs", { name: "tabs.windowRequest", data: { request, profile } satisfies WindowRequest });
}

export function offeredTabAdopted(adoptId: string | undefined) {
  if (adoptId === undefined || !unadopted.has(adoptId)) return;
  clearTimeout(unadopted.get(adoptId));
  unadopted.delete(adoptId);
}
