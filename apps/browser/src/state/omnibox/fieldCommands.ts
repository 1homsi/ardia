import type { BrowserState } from "../browser/store";
import { customNewTabUrl } from "../settings/settings";
import { fieldTookFocus, fieldWontTakeFocus } from "./typeAhead";

export function noteFieldCommand(s: BrowserState, windowId: string, command: string, onPage: boolean) {
  if (command === "focusCommandBar" && onPage && s.windowUi[windowId]?.panel.open) fieldTookFocus(windowId);
  if (command === "newTab" && customNewTabUrl(s.settings)) fieldWontTakeFocus(windowId);
}
