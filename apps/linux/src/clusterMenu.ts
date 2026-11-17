import { reportHostError } from "./host.ts";

type PressTarget = { addEventListener(type: "pointerdown", listener: (event: { target: EventTarget | null }) => void, capture: boolean): void };
type Anchor = { closest(selector: string): Element | null };

export function createClusterMenu(target: PressTarget | null, open: (windowId: string, anchor: HTMLElement) => Promise<unknown>, shown: () => boolean, focused: () => Element | null) {
  let pressed: Anchor | null = null;
  let openAtPress = false;
  target?.addEventListener("pointerdown", (event) => {
    pressed = event.target && "closest" in event.target ? (event.target as Anchor) : null;
    openAtPress = shown();
  }, true);
  return (windowId: string) => {
    const anchor = pressed?.closest('[role="button"]') ?? focused();
    const wasOpen = openAtPress;
    pressed = null;
    openAtPress = false;
    if (wasOpen || !anchor) return Promise.resolve();
    return open(windowId, anchor as HTMLElement).catch(reportHostError);
  };
}
