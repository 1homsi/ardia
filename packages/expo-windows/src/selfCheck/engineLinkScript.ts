import { engineAvailable, hostCall, onEngineTopic } from "../engine/host";
import { httpPagesPort } from "./engineBackForward";
import { expectEqual, expectTrue, type Check } from "./check";
import { click, evaluate, firstWindow, hide, LEFT, LINKS_TITLE, listed, loaded, pause, show, sleepOnce, timedCall, until, withPages } from "./engineSleep";

const WAKES = 20;
const QUICK_CLOSES = 10;
const NAVIGATIONS = 10;
const OPEN_MS = 3000;
const LOAD_MS = 20000;
const BLANK_LINK = { x: 110, y: 90 };
const PAINT_TRIES = 3;
const FRESH_TABS = 50;
const DISCARD_WAKES = 50;

type Paint = "before" | "after" | "unknown";
type Round = { received: boolean; opened: boolean; fromClick: unknown; paint: Paint; tries: number };

const CONTENTFUL_PAINT_AT = 'const paint = performance.getEntriesByName("first-contentful-paint")[0]; post("result", JSON.stringify(paint ? performance.timeOrigin + (paint.paintTime ?? paint.startTime) : null));';

async function clickAtOnce(page: string): Promise<Round> {
  let opened = false;
  let fromClick: unknown = null;
  let sentBy = 0;
  const watching = onEngineTopic("tab.opened", (event: { opener?: unknown; fromClick?: unknown; adopt?: unknown }) => {
    if (event.opener !== page || opened) return;
    opened = true;
    fromClick = event.fromClick;
    if (typeof event.adopt === "string") void hostCall("tab.discard", { adopt: event.adopt }).catch(() => null);
  });
  try {
    await click(page, BLANK_LINK.x, BLANK_LINK.y);
    sentBy = Date.now();
    const by = sentBy + OPEN_MS;
    while (!opened && Date.now() < by) await pause(50);
  } finally {
    watching.remove();
  }
  const downs = await evaluate(page, 'post("result", JSON.stringify(window.downs));').catch(() => null);
  const paintedAt = await evaluate(page, CONTENTFUL_PAINT_AT).catch(() => null);
  const paint: Paint = typeof paintedAt !== "number" ? "unknown" : sentBy < paintedAt ? "before" : "after";
  return { received: Number(downs) > 0, opened, fromClick, paint, tries: 1 };
}

async function roundOf(play: () => Promise<Round>): Promise<Round> {
  let round = await play();
  for (let tries = 2; tries <= PAINT_TRIES && !round.received && round.paint === "unknown"; tries++) round = { ...(await play()), tries };
  return round;
}

function counted(rounds: Round[], what: string) {
  const missed = rounds.filter((round) => round.received && !(round.opened && round.fromClick === true)).length;
  const lost = rounds.filter((round) => !round.received);
  const lostAfterPaint = lost.filter((round) => round.paint === "after").length;
  const lostUnknown = lost.filter((round) => round.paint === "unknown").length;
  const reached = rounds.length - lost.length;
  const lostBeforePaint = lost.length - lostAfterPaint - lostUnknown;
  const retried = rounds.filter((round) => round.tries > 1).length;
  console.info(`[ardia windows] self-check note: link script rounds, ${what}: ${rounds.length} clicks, ${reached} reached the page, ${missed} of those missed by the link script, ${lostBeforePaint} lost before first contentful paint, ${lostAfterPaint} lost after it, ${lostUnknown} lost with no paint entry after ${PAINT_TRIES} tries, ${retried} rounds retried for a missing paint entry`);
  return { missed, lostAfterPaint, lostUnknown, reached };
}

function judge(rounds: Round[], what: string) {
  const { missed, lostAfterPaint, lostUnknown, reached } = counted(rounds, what);
  expectEqual(
    { missed, lostAfterPaint, lostUnknown, mostReached: reached * 2 >= rounds.length },
    { missed: 0, lostAfterPaint: 0, lostUnknown: 0, mostReached: true },
    `${what}: every click the page received opened a tab its link script saw, every click that never reached the page was sent before the page's first contentful paint (Chromium drops input while it holds commits for that paint; a round with no paint entry is played again, up to ${PAINT_TRIES} times), and at least half reached the page (${reached} of ${rounds.length}) ${JSON.stringify(rounds)}`,
  );
}

async function freshRound(port: string, windowId: string, index: number): Promise<Round> {
  const key = `self-check-links-fresh-${index}`;
  await timedCall("tab.create", { key, url: `http://127.0.0.1:${port}/links?fresh${index}`, profile: "" }, windowId);
  try {
    await timedCall("tab.show", { key, visible: true, ...LEFT }, windowId);
    await loaded(key, LINKS_TITLE);
    return await clickAtOnce(key);
  } finally {
    await timedCall("tab.close", { key });
  }
}

async function discardedAndWoken(page: string, windowId: string) {
  await hide(page, windowId);
  const outcome = (await timedCall<{ outcome?: unknown }>("tab.call", { key: page, method: "discard" })).outcome;
  expectEqual(outcome, "discarded", "the hidden page is discarded");
  await show(page, windowId, LEFT);
  await loaded(page, LINKS_TITLE);
}

const linkScriptChecks = (port: string): Check[] => [
  {
    name: "engine links: a tab closed before its link script finishes registering closes, and the engine keeps answering",
    run: async () => {
      const windowId = await firstWindow();
      for (let i = 0; i < QUICK_CLOSES; i++) {
        const key = `self-check-links-quick-close-${i}`;
        await timedCall("tab.create", { key, url: `http://127.0.0.1:${port}/links?quick${i}`, profile: "" }, windowId);
        await timedCall("tab.close", { key });
      }
      const tabs = (await timedCall<{ tabs?: { key: string }[] }>("tabs.list")).tabs ?? [];
      expectTrue(!tabs.some((tab) => tab.key.startsWith("self-check-links-quick-close-")), `every quickly closed tab is gone (${JSON.stringify(tabs.map((tab) => tab.key))})`);
    },
  },
  {
    name: "engine links: the link script sees the first click on a page that just woke from sleep",
    run: () =>
      withPages(
        ["first-click"],
        async ([page], windowId) => {
          await show(page!, windowId, LEFT);
          const rounds: Round[] = [];
          for (let i = 0; i < WAKES; i++) {
            rounds.push(await roundOf(async () => (await sleepOnce(page!, windowId, LINKS_TITLE), clickAtOnce(page!))));
          }
          judge(rounds, "clicks at once after a wake");
        },
        "links",
        LINKS_TITLE,
      ),
  },
  {
    name: "engine links: the link script sees the first click on a page reached by a cross-process navigation",
    run: () =>
      withPages(
        ["cross-process"],
        async ([page], windowId) => {
          await show(page!, windowId, LEFT);
          const rounds: Round[] = [];
          for (let i = 0; i < NAVIGATIONS; i++) {
            rounds.push(
              await roundOf(async () => {
                const host = new URL(String((await listed(page!))?.url)).hostname === "localhost" ? "127.0.0.1" : "localhost";
                const url = `http://${host}:${port}/links?round${i}-${Date.now()}`;
                await hostCall("tab.call", { key: page, method: "loadUrl", url });
                await until(`the page ${page} shows ${host}`, LOAD_MS, () => listed(page!), (tab) => String(tab?.url) === url && tab?.title === LINKS_TITLE && tab.loading === false);
                return clickAtOnce(page!);
              }),
            );
          }
          judge(rounds, "clicks at once after a cross-process navigation");
        },
        "links",
        LINKS_TITLE,
      ),
  },
  {
    name: "engine links: measurement, clicks at once on freshly created tabs (logged; asserts only that the engine keeps answering)",
    run: async () => {
      const windowId = await firstWindow();
      const rounds: Round[] = [];
      for (let i = 0; i < FRESH_TABS; i++) rounds.push(await roundOf(() => freshRound(port, windowId, i)));
      counted(rounds, "link script first document, clicks at once on a freshly created tab");
      expectTrue(Array.isArray((await timedCall<{ tabs?: unknown }>("tabs.list")).tabs), "the engine still lists tabs");
    },
  },
  {
    name: "engine links: measurement, clicks at once on a tab discarded and woken (logged; asserts only that the engine keeps answering)",
    run: () =>
      withPages(
        ["discard-wake"],
        async ([page], windowId) => {
          await show(page!, windowId, LEFT);
          const rounds: Round[] = [];
          for (let i = 0; i < DISCARD_WAKES; i++) rounds.push(await roundOf(async () => (await discardedAndWoken(page!, windowId), clickAtOnce(page!))));
          counted(rounds, "link script first document, clicks at once on a tab discarded and woken");
          expectTrue(Array.isArray((await timedCall<{ tabs?: unknown }>("tabs.list")).tabs), "the engine still lists tabs");
        },
        "links",
        LINKS_TITLE,
      ),
  },
];

const port = engineAvailable() ? httpPagesPort() : null;

export const checks: Check[] = port ? linkScriptChecks(port) : [];
