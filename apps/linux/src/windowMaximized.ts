import { invokeHost, reportHostError, type ArdiaHost } from "./host.ts";
import { fillsScreen, isWindowFrame, type WorkArea } from "./windowFrame.ts";
import { useMaximizedWindows } from "../../browser/src/state/windows/captionRegions.ts";

type ShellWindow = { screen?: WorkArea; outerWidth: number; outerHeight: number; addEventListener(type: "resize", listener: () => void): void };

export function noteMaximized(windowId: string, on: boolean) {
  useMaximizedWindows.setState((shown) => {
    if (!!shown[windowId] === on) return shown;
    const { [windowId]: _, ...rest } = shown;
    return on ? { ...shown, [windowId]: true } : rest;
  }, true);
}

export function followWindowMaximized(host: ArdiaHost, windowId: string, shell: ShellWindow | null = typeof window === "undefined" ? null : window, note = noteMaximized) {
  if (!shell) return;
  let latest = 0;
  const read = () => {
    const asked = ++latest;
    void invokeHost<unknown>("ArdiaShell.windowFrame", { args: [windowId] }, host).then((frame) => {
      if (asked !== latest) return;
      note(windowId, fillsScreen(isWindowFrame(frame) ? frame : [0, 0, shell.outerWidth, shell.outerHeight], shell.screen));
    }, reportHostError);
  };
  read();
  shell.addEventListener("resize", read);
}
