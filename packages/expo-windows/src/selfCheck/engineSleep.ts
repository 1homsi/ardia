import type { WindowsNative } from "@ardia/shell";
import { engineAvailable, hostCall } from "../engine/host";
import { requireNativeModule } from "../modules";
import { httpPagesPort } from "./engineBackForward";
import { expectEqual, expectTrue, type Check } from "./check";

const VISIBLE = 4;
const RECENTLY_VISIBLE = 7;
const DEVTOOLS_OPEN = 24;
const FORM_INTERACTIONS = 26;
const USER_EDITS = 27;
const TITLE = "sleep page";
const LOAD_MS = 20000;
const DEVTOOLS_GONE_MS = 3000;
const POLL_MS = 100;
const SCROLLED_TO = 3000;
const LEFT = { unit: "px", x: 0, y: 40, width: 300, height: 240 };
const RIGHT = { unit: "px", x: 310, y: 40, width: 300, height: 240 };

type Listed = { key?: unknown; title?: unknown; loading?: unknown; discarded?: unknown; url?: unknown };

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const firstWindow = async () => {
  const ids = await requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows").windowIds();
  expectTrue(ids.length > 0, "no window is open to host a page");
  return ids[0]!;
};

const listed = async (key: string) => (await hostCall<{ tabs?: Listed[] }>("tabs.list")).tabs?.find((tab) => tab.key === key);

async function until<T>(what: string, ms: number, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const by = Date.now() + ms;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > by) throw new Error(`${what} within ${ms} ms: last ${JSON.stringify(value)}`);
    await pause(POLL_MS);
    value = await read();
  }
  return value;
}

const loaded = (key: string) => until(`the page ${key} loads`, LOAD_MS, () => listed(key), (tab) => tab?.title === TITLE && tab.loading === false && tab.discarded !== true);

const evaluate = async (key: string, code: string) => {
  const reply = await hostCall<{ result?: unknown }>("tab.call", { key, method: "evaluate", code });
  return typeof reply.result === "string" ? (JSON.parse(reply.result) as unknown) : null;
};

const keptBy = (key: string, seconds: number) =>
  until(
    `the page ${key} is asked to sleep with no DevTools session left from the check's own calls`,
    DEVTOOLS_GONE_MS,
    async () => (await hostCall<{ keptBy?: unknown }>("tab.call", { key, method: "sleepIfHidden", seconds })).keptBy,
    (kept) => !(Array.isArray(kept) && kept.length === 1 && kept[0] === DEVTOOLS_OPEN),
  );

async function withPages(names: string[], run: (keys: string[], windowId: string) => Promise<void>) {
  const port = httpPagesPort();
  expectTrue(port, "the launch has no loopback page server (test httpPages)");
  const windowId = await firstWindow();
  const keys = names.map((name) => `self-check-sleep-${name}`);
  try {
    for (const [index, key] of keys.entries()) await hostCall("tab.create", { key, url: `http://127.0.0.1:${port}/sleep?${names[index]}`, profile: "" }, windowId);
    for (const key of keys) await loaded(key);
    await run(keys, windowId);
  } finally {
    for (const key of keys) await hostCall("tab.close", { key }).catch(() => null);
  }
}

const show = (key: string, windowId: string, place: object) => hostCall("tab.show", { key, visible: true, ...place }, windowId);
const hide = (key: string, windowId: string) => hostCall("tab.show", { key, visible: false }, windowId);

const sleepChecks: Check[] = [
  {
    name: "engine sleep: a shown page and the second pane of a split, shown beside it, are kept awake as visible",
    run: () =>
      withPages(["shown", "pane"], async ([shown, pane], windowId) => {
        await show(shown!, windowId, LEFT);
        await show(pane!, windowId, RIGHT);
        const kept = { shown: await keptBy(shown!, 0), pane: await keptBy(pane!, 0) };
        expectTrue(Array.isArray(kept.shown) && kept.shown.includes(VISIBLE) && Array.isArray(kept.pane) && kept.pane.includes(VISIBLE), `both kept as visible (${VISIBLE}): ${JSON.stringify(kept)}`);
        expectEqual([(await listed(shown!))?.discarded, (await listed(pane!))?.discarded], [false, false], "both pages still loaded");
      }),
  },
  {
    name: "engine sleep: a page hidden moments ago is kept as recently visible while the app's hidden time hasn't passed",
    run: () =>
      withPages(["recent"], async ([recent], windowId) => {
        await show(recent!, windowId, LEFT);
        await hide(recent!, windowId);
        const kept = await keptBy(recent!, 3600);
        expectTrue(Array.isArray(kept) && kept.includes(RECENTLY_VISIBLE), `kept as recently visible (${RECENTLY_VISIBLE}): ${JSON.stringify(kept)}`);
        expectEqual((await listed(recent!))?.discarded, false, "the page still loaded");
      }),
  },
  {
    name: "engine sleep: a hidden page with text typed into a form is kept, so the typing isn't lost",
    run: () =>
      withPages(["form"], async ([form], windowId) => {
        await show(form!, windowId, LEFT);
        await evaluate(form!, `document.getElementById("field").focus(); post("result", "null");`);
        await hostCall("tab.call", { key: form!, method: "insertText", text: "typed by the self-check" });
        expectEqual(await evaluate(form!, `post("result", JSON.stringify(document.getElementById("field").value));`), "typed by the self-check", "the field's text");
        await hide(form!, windowId);
        const kept = await keptBy(form!, 0);
        expectTrue(Array.isArray(kept) && (kept.includes(FORM_INTERACTIONS) || kept.includes(USER_EDITS)), `kept for its form (${FORM_INTERACTIONS} or ${USER_EDITS}): ${JSON.stringify(kept)}`);
        expectEqual((await listed(form!))?.discarded, false, "the page still loaded");
      }),
  },
  {
    name: "engine sleep: a hidden quiet page sleeps when asked, and wakes on show at the same address and scroll",
    run: () =>
      withPages(["quiet"], async ([quiet], windowId) => {
        await show(quiet!, windowId, LEFT);
        const scrolled = await evaluate(quiet!, `window.scrollTo(0, ${SCROLLED_TO}); setTimeout(() => post("result", JSON.stringify(Math.round(window.scrollY))), 50);`);
        expectEqual(scrolled, SCROLLED_TO, "the page's scroll before it sleeps");
        const address = (await listed(quiet!))?.url;
        await hide(quiet!, windowId);
        expectEqual(await keptBy(quiet!, 0), [], "nothing keeps a hidden quiet page awake once the hidden time has passed");
        expectEqual((await listed(quiet!))?.discarded, true, "the page is discarded");
        await show(quiet!, windowId, LEFT);
        const woke = await loaded(quiet!);
        expectEqual(woke?.url, address, "the address after it wakes");
        const back = await until("the scroll comes back", LOAD_MS, () => evaluate(quiet!, `post("result", JSON.stringify(Math.round(window.scrollY)));`), (y) => y === SCROLLED_TO);
        expectEqual(back, SCROLLED_TO, "the scroll after it wakes");
      }),
  },
  {
    name: "engine sleep: a hidden page whose DevTools window is open is kept, and sleeps once that window is closed",
    run: () =>
      withPages(["devtools"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        await hide(page!, windowId);
        await hostCall("tab.call", { key: page!, method: "showDevTools" });
        let open = true;
        try {
          const kept = await hostCall<{ keptBy?: unknown }>("tab.call", { key: page!, method: "sleepIfHidden", seconds: 0 });
          expectTrue(Array.isArray(kept.keptBy) && kept.keptBy.includes(DEVTOOLS_OPEN), `kept while its DevTools window is open (${DEVTOOLS_OPEN}): ${JSON.stringify(kept.keptBy)}`);
          await hostCall("tab.call", { key: page!, method: "showDevTools", panel: "toggle" });
          open = false;
          const after = await until(
            "the page sleeps once its DevTools window is closed",
            DEVTOOLS_GONE_MS,
            async () => (await hostCall<{ keptBy?: unknown }>("tab.call", { key: page!, method: "sleepIfHidden", seconds: 0 })).keptBy,
            (keptBy) => Array.isArray(keptBy) && keptBy.length === 0,
          );
          expectEqual(after, [], "nothing keeps it once the window is closed");
        } finally {
          if (open) await hostCall("tab.call", { key: page!, method: "showDevTools", panel: "toggle" }).catch(() => null);
        }
      }),
  },
];

export const checks: Check[] = engineAvailable() ? sleepChecks : [];
