import { useBrowser, type BrowserState } from "../../browser/src/state/browser/store";
import { useWindowId } from "../../browser/src/state/browser/hooks";
import { WINDOW_CHROME, type WindowChrome } from "../../browser/src/lib/windowChrome";
import { addressBarInSidebar, pageFrameIn, sidebarHeaderCollapsed, windowControlsPlace } from "../../browser/src/state/windows/layout";

export * from "../../browser/src/state/windows/layout";

export const menuBesideWindowButtons = (s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  chrome.trailingWidth > 0 && windowControlsPlace(s, windowId, pageFrameIn(s, windowId), chrome) !== null;

export const linuxSidebarHeaderCollapsed = (s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  sidebarHeaderCollapsed(s, windowId, chrome) && menuBesideWindowButtons(s, windowId, chrome);

export const linuxDownloadsInSidebarFooter = (s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  addressBarInSidebar(s, windowId) || linuxSidebarHeaderCollapsed(s, windowId, chrome);

export function useSidebarHeaderCollapsed(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => linuxSidebarHeaderCollapsed(s, windowId));
}

export function useDownloadsInSidebarFooter(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => linuxDownloadsInSidebarFooter(s, windowId));
}

export function useMenuBesideWindowButtons(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => menuBesideWindowButtons(s, windowId));
}
