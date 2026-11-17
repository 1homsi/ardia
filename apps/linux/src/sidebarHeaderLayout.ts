import { useBrowser, type BrowserState } from "../../browser/src/state/browser/store";
import { useWindowId } from "../../browser/src/state/browser/hooks";
import { useFullscreenTab } from "../../browser/src/state/tabs/pageState";
import { WINDOW_CHROME, type WindowChrome } from "../../browser/src/lib/windowChrome";
import { addressBarInSidebar, pageFrameIn, sidebarCaptionRoom, sidebarHeaderCollapsed, windowControlsPlace } from "../../browser/src/state/windows/layout";
import { windowButtonsRendered } from "./windowControlsRules";

export * from "../../browser/src/state/windows/layout";

export const menuBesideWindowButtons = (s: BrowserState, windowId: string, pageFullScreen: boolean, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  windowButtonsRendered({ placed: chrome.trailingWidth > 0 && windowControlsPlace(s, windowId, pageFrameIn(s, windowId), chrome) !== null, pageFullScreen });

export const linuxSidebarCaptionRoom = (s: BrowserState, windowId: string, pageFullScreen: boolean, chrome: WindowChrome = WINDOW_CHROME): number =>
  menuBesideWindowButtons(s, windowId, pageFullScreen, chrome) ? sidebarCaptionRoom(s, windowId, chrome) : 0;

export const linuxSidebarHeaderCollapsed = (s: BrowserState, windowId: string, pageFullScreen: boolean, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  sidebarHeaderCollapsed(s, windowId, chrome) && menuBesideWindowButtons(s, windowId, pageFullScreen, chrome);

export const linuxDownloadsInSidebarFooter = (s: BrowserState, windowId: string, pageFullScreen: boolean, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  addressBarInSidebar(s, windowId) || linuxSidebarHeaderCollapsed(s, windowId, pageFullScreen, chrome);

export function useSidebarHeaderCollapsed(): boolean {
  const windowId = useWindowId();
  const pageFullScreen = !!useFullscreenTab(windowId);
  return useBrowser((s) => linuxSidebarHeaderCollapsed(s, windowId, pageFullScreen));
}

export function useDownloadsInSidebarFooter(): boolean {
  const windowId = useWindowId();
  const pageFullScreen = !!useFullscreenTab(windowId);
  return useBrowser((s) => linuxDownloadsInSidebarFooter(s, windowId, pageFullScreen));
}

export function useMenuBesideWindowButtons(): boolean {
  const windowId = useWindowId();
  const pageFullScreen = !!useFullscreenTab(windowId);
  return useBrowser((s) => menuBesideWindowButtons(s, windowId, pageFullScreen));
}

export function useSidebarCaptionRoom(): number {
  const windowId = useWindowId();
  const pageFullScreen = !!useFullscreenTab(windowId);
  return useBrowser((s) => linuxSidebarCaptionRoom(s, windowId, pageFullScreen));
}
