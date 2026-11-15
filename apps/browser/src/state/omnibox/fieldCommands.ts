import type { BrowserState } from "../browser/store";
import { customNewTabUrl } from "../settings/settings";
import { fieldTookFocus, fieldWontTakeFocus } from "./typeAhead";

type BarKind = "panel" | "hero" | "sidebar";
type Told = "ready" | "cancel" | null;

const AWAIT_MS = 3000;

const awaiting = new Map<string, number>();
const focusedPanels = new Set<string>();

function ready(windowId: string, now: number): Told {
  const since = awaiting.get(windowId);
  awaiting.delete(windowId);
  if (since === undefined || now - since >= AWAIT_MS) return null;
  fieldTookFocus(windowId);
  return "ready";
}

export function noteFieldCommand(s: Pick<BrowserState, "windowUi" | "settings">, windowId: string, command: string, onPage: boolean, now = Date.now()): Told {
  if (command !== "newTab" && command !== "focusCommandBar") return null;
  awaiting.set(windowId, now);
  if (command === "focusCommandBar" && onPage && s.windowUi[windowId]?.panel.open && focusedPanels.has(windowId)) return ready(windowId, now);
  if (command !== "newTab" || !customNewTabUrl(s.settings)) return null;
  awaiting.delete(windowId);
  fieldWontTakeFocus(windowId);
  return "cancel";
}

export function barFocused(windowId: string, kind: BarKind, now = Date.now()): Told {
  if (kind !== "hero") focusedPanels.add(windowId);
  return ready(windowId, now);
}

export function barBlurred(windowId: string, kind: BarKind) {
  if (kind !== "hero") focusedPanels.delete(windowId);
}

export const barAskedWhileFocused = (windowId: string, now = Date.now()): Told => ready(windowId, now);
