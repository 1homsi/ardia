import { reportHostError } from "./host.ts";

type Anchor = { closest(selector: string): Element | null };
type ActivationTarget = {
  addEventListener(type: "pointerdown", listener: (event: { target: EventTarget | null }) => void, capture: boolean): void;
  addEventListener(type: "keydown", listener: (event: { key: string }) => void, capture: boolean): void;
};

export const CLUSTER_MENU_BUTTON = '[role="button"][aria-label="Menu"]';

export function createClusterMenu(target: ActivationTarget | null, open: (windowId: string, anchor: HTMLElement) => Promise<unknown>, shown: () => boolean, focused: () => Element | null) {
  let pressed: Element | null = null;
  let openAtPress = false;
  target?.addEventListener("pointerdown", (event) => {
    const hit = event.target && "closest" in event.target ? (event.target as Anchor).closest(CLUSTER_MENU_BUTTON) : null;
    pressed = hit;
    openAtPress = !!hit && shown();
  }, true);
  target?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    pressed = null;
    openAtPress = false;
  }, true);
  return (windowId: string) => {
    const anchor = pressed ?? focused();
    const wasOpen = openAtPress;
    pressed = null;
    openAtPress = false;
    if (wasOpen || !anchor) return Promise.resolve();
    return open(windowId, anchor as HTMLElement).catch(reportHostError);
  };
}
