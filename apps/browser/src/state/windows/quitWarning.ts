import { confirm } from "../../platform/dialogs";
import { windowIds } from "../../platform/windows";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { backgroundInstance } from "../app/appSettings";
import { useBrowser } from "../browser/store";

export const QUIT_WARNING = {
  title: "Are you sure you want to quit Ardia?",
  message: "Your windows and tabs will be restored the next time you open it.",
  confirmTitle: "Quit",
  suppression: "Don’t ask again",
} as const;

export type QuitWarning = "notAsked" | "confirmed" | "cancelled";

type Asking = { quitsWithLastWindow: boolean; background: boolean; warns: boolean; openWindowIds: readonly string[]; closing: string };

export const closingQuits = ({ quitsWithLastWindow, openWindowIds, closing }: Pick<Asking, "quitsWithLastWindow" | "openWindowIds" | "closing">) =>
  quitsWithLastWindow && openWindowIds.length > 0 && openWindowIds.every((id) => id === closing);

export const asksBeforeQuit = (asking: Asking) => !asking.background && asking.warns && closingQuits(asking);

export async function askBeforeQuitting(windowId: string): Promise<QuitWarning> {
  const { quitsWithLastWindow } = PLATFORM_FEATURES;
  const warns = useBrowser.getState().settings.warnBeforeQuitting;
  if (!quitsWithLastWindow || backgroundInstance || !warns) return "notAsked";
  const openWindowIds = await windowIds().catch(() => [] as string[]);
  if (!asksBeforeQuit({ quitsWithLastWindow, background: backgroundInstance, warns, openWindowIds, closing: windowId })) return "notAsked";
  const { confirmed, suppressed } = await confirm({ ...QUIT_WARNING, windowId });
  if (suppressed) useBrowser.getState().updateSettings({ warnBeforeQuitting: false });
  return confirmed ? "confirmed" : "cancelled";
}
