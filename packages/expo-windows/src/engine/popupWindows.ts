import type { WindowEvent } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import { addNativeListener, type EventSubscription } from "../events";
import type { AppWindowsModule } from "../nativeModuleTypes";
import { popupFrame, popupSize, popupTitle, type PopupFeatures } from "./popupPlacement";
import { privateWindowShown } from "./privateWindows";

export const POPUP_WINDOW_PREFIX = "popup:";

export type PopupWindowInfo = {
  windowId: string;
  pageKey: string;
  adopt: string;
  url: string;
  profile: string;
  openerKey: string;
};

export type PopupWindowAsk = {
  adopt: string;
  url: string;
  profile: string;
  openerKey: string;
  openerWindowId: string;
  features: PopupFeatures;
};

type PopupWindows = TurboModule & Pick<AppWindowsModule, "openWindow" | "closeWindow" | "windowFrame" | "windowIds" | "setWindowTitle">;

const WINDOWS_MODULE = "ArdiaAppWindows";

const windows = (): PopupWindows => {
  const native = TurboModuleRegistry.get<PopupWindows>(WINDOWS_MODULE);
  if (!native) throw new Error(`${WINDOWS_MODULE} has no native module`);
  return native;
};

export type PopupWindowOutcome = "shown" | "closed" | "failed";

const popups = new Map<string, PopupWindowInfo>();
const privateHolds = new Map<string, () => void>();
const closedListeners = new Set<(popup: PopupWindowInfo) => void>();
let closes: EventSubscription | null = null;
let made = 0;

export const isPopupWindowId = (windowId: string | null | undefined) => typeof windowId === "string" && windowId.startsWith(POPUP_WINDOW_PREFIX);

export const popupWindowInfo = (windowId: string): PopupWindowInfo | null => popups.get(windowId) ?? null;

export const popupOpenerKey = (windowId: string) => popups.get(windowId)?.openerKey ?? "";

export const openPopupWindowCount = () => popups.size;

export function onPopupWindowClosed(listener: (popup: PopupWindowInfo) => void): () => void {
  closedListeners.add(listener);
  return () => void closedListeners.delete(listener);
}

function letGoOfPrivateSession(windowId: string) {
  privateHolds.get(windowId)?.();
  privateHolds.delete(windowId);
}

function popupClosed(windowId: string) {
  const popup = popups.get(windowId);
  if (!popup) return;
  popups.delete(windowId);
  letGoOfPrivateSession(windowId);
  for (const listener of [...closedListeners]) listener(popup);
}

function listenForCloses() {
  closes ??= addNativeListener(WINDOWS_MODULE, "onWindowEvent", (payload) => {
    const event = payload as WindowEvent | null;
    if (event?.type === "close" && isPopupWindowId(event.id)) popupClosed(event.id);
  });
}

const openerFrame = (windowId: string) =>
  windowId
    ? Promise.resolve(windows().windowFrame(windowId)).then(
        (frame) => frame ?? null,
        () => null,
      )
    : Promise.resolve(null);

export async function openPopupWindow(ask: PopupWindowAsk): Promise<PopupWindowOutcome> {
  listenForCloses();
  made += 1;
  const windowId = `${POPUP_WINDOW_PREFIX}${Date.now().toString(36)}-${made}`;
  popups.set(windowId, { windowId, pageKey: `${windowId}:page`, adopt: ask.adopt, url: ask.url, profile: ask.profile, openerKey: ask.openerKey });
  privateHolds.set(windowId, privateWindowShown(ask.profile));
  try {
    const frame = popupFrame(ask.features, await openerFrame(ask.openerWindowId));
    await windows().openWindow(windowId, {
      kind: "popup",
      title: popupTitle("", ask.url),
      focus: true,
      profile: ask.profile,
      ...(frame ? { frame } : { size: popupSize(ask.features) }),
    });
    if (!popups.has(windowId)) return "closed";
    if ((await windows().windowIds()).includes(windowId)) return "shown";
    if (!popups.has(windowId)) return "closed";
    console.warn("[ardia windows] a pop-up window did not open; its page goes to a tab");
  } catch (error) {
    if (!popups.has(windowId)) return "closed";
    console.warn(`[ardia windows] a pop-up window did not open: ${String((error as Error)?.message ?? error)}`);
  }
  popups.delete(windowId);
  letGoOfPrivateSession(windowId);
  return "failed";
}

export function closePopupWindow(windowId: string) {
  if (!popups.has(windowId)) return;
  void Promise.resolve(windows().closeWindow(windowId)).catch(() => {});
}

export function setPopupWindowTitle(windowId: string, title: string) {
  if (!popups.has(windowId)) return;
  void Promise.resolve(windows().setWindowTitle(windowId, title)).catch(() => {});
}
