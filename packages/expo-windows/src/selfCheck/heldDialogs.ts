import type { WindowsNative } from "@ardia/shell";
import { engineAvailable, hostCall, onEngineTopic } from "../engine/host";
import { requireNativeModule } from "../modules";
import type { DialogsModule } from "../nativeModuleTypes";
import { expectTrue, type Check } from "./check";
import type { TabEvent } from "./engineHost";

const LOAD_MS = 8000;
const STALLED_MS = 3000;
const SHOWN_MS = 4000;
const CANCELLED_WITHIN_MS = 1000;

const dialogs = () => requireNativeModule<Pick<DialogsModule, "openCount" | "devHoldConfirm" | "devHoldFileDialog" | "devReleaseDialogs">>("ArdiaDialogs");
const windows = () => requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const pageLoads = (key: string, title: string, withinMs: number) =>
  new Promise<boolean>((resolve) => {
    const watching = onEngineTopic("tab", (event: TabEvent) => {
      if (event.key !== key || event.name !== "navigation") return;
      if (event.data?.title !== title || event.data.isLoading !== false) return;
      clearTimeout(deadline);
      watching.remove();
      resolve(true);
    });
    const deadline = setTimeout(() => {
      watching.remove();
      resolve(false);
    }, withinMs);
  });

async function heldConfirmShown() {
  for (let waited = 0; waited < SHOWN_MS; waited += 100) {
    if (dialogs().openCount() > 0) return true;
    await settled(100);
  }
  return false;
}

async function loadWhileHeld(onUiThread: boolean, key: string, withinMs: number) {
  const [windowId] = await windows().windowIds();
  expectTrue(windowId, "no window is open to own the held confirm");
  const held = dialogs().devHoldConfirm(windowId, onUiThread);
  let created: Promise<unknown> = Promise.resolve();
  try {
    expectTrue(await heldConfirmShown(), "the held confirm never opened");
    const title = `held confirm ${key}`;
    const loaded = pageLoads(key, title, withinMs);
    created = hostCall("tab.create", { key, url: `data:text/html,<title>${title}</title><p>loaded while a confirm was open</p>`, profile: "" }, windowId).catch(() => undefined);
    return await loaded;
  } finally {
    dialogs().devReleaseDialogs();
    await held;
    await created;
    await hostCall("tab.close", { key }).catch(() => undefined);
  }
}

async function countStays(count: number, forMs: number) {
  for (let waited = 0; waited < forMs; waited += 100) {
    if (dialogs().openCount() !== count) return false;
    await settled(100);
  }
  return true;
}

async function closesWithin(withinMs: number) {
  const began = Date.now();
  while (Date.now() - began < withinMs) {
    if (dialogs().openCount() === 0) return Date.now() - began;
    await settled(20);
  }
  return null;
}

async function heldFileDialogCancels(save: boolean) {
  const [windowId] = await windows().windowIds();
  expectTrue(windowId, "no window is open to own the held file dialog");
  const held = dialogs().devHoldFileDialog(windowId, save);
  try {
    expectTrue(await heldConfirmShown(), `the held ${save ? "save panel" : "file picker"} never opened`);
    dialogs().devReleaseDialogs();
    const took = await closesWithin(CANCELLED_WITHIN_MS);
    expectTrue(took !== null, `the ${save ? "save panel" : "file picker"} was still open ${CANCELLED_WITHIN_MS} ms after its cancel`);
    console.info(`[ardia windows] held ${save ? "save panel" : "file picker"} closed ${took} ms after its cancel`);
    expectTrue((await held) === false, "the cancelled dialog reported a pick");
  } finally {
    dialogs().devReleaseDialogs();
    await held;
  }
}

export const checks: Check[] = [
  {
    name: "a file picker the app cancels (as at quit) closes at once, so a quit with one open needn't wait",
    run: () => heldFileDialogCancels(false),
  },
  {
    name: "a save panel the app cancels closes at once too",
    run: () => heldFileDialogCancels(true),
  },
  {
    name: "a second dialog for the same window waits until the first closes",
    async run() {
      const [windowId] = await windows().windowIds();
      expectTrue(windowId, "no window is open to own the held confirms");
      const first = dialogs().devHoldConfirm(windowId, false);
      let second: Promise<boolean> = Promise.resolve(false);
      try {
        expectTrue(await heldConfirmShown(), "the first held confirm never opened");
        second = dialogs().devHoldConfirm(windowId, false);
        expectTrue(await countStays(1, 1000), `${dialogs().openCount()} dialogs open at once for one window`);
        dialogs().devReleaseDialogs();
        await first;
        expectTrue(await heldConfirmShown(), "the second held confirm never opened after the first closed");
      } finally {
        dialogs().devReleaseDialogs();
        await Promise.all([first, second]);
      }
      expectTrue(await countStays(0, 300), "a released confirm is still counted as open");
    },
  },
  {
    name: "a confirm runs on its own thread: with one open, a page created meanwhile loads",
    async run() {
      if (!engineAvailable()) return;
      expectTrue(await loadWhileHeld(false, "held-confirm-own-thread", LOAD_MS), `the page didn't load within ${LOAD_MS} ms while a confirm was open`);
      expectTrue(dialogs().openCount() === 0, "the released confirm is still counted as open");
    },
  },
  {
    name: "the control: the same confirm on the UI thread stalls Chromium, so the page waits until it closes",
    async run() {
      if (!engineAvailable()) return;
      expectTrue(!(await loadWhileHeld(true, "held-confirm-ui-thread", STALLED_MS)), "the page loaded while a confirm held the UI thread: this check no longer tells a stalled UI thread apart");
    },
  },
];
