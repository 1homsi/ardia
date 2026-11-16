import { engineAvailable, hostCall, onEngineTopic } from "../engine/host";
import { httpPagesPort } from "./engineBackForward";
import { expectEqual, type Check } from "./check";
import { click, evaluate, LEFT, LINKS_TITLE, listed, pause, show, sleepOnce, until, withPages } from "./engineSleep";

const WAKES = 20;
const NAVIGATIONS = 10;
const OPEN_MS = 3000;
const LOAD_MS = 20000;
const BLANK_LINK = { x: 110, y: 90 };

type Round = { received: boolean; opened: boolean; fromClick: unknown; sentBeforePaint: boolean };

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
  return { received: Number(downs) > 0, opened, fromClick, sentBeforePaint: typeof paintedAt !== "number" || sentBy < paintedAt };
}

function judge(rounds: Round[], what: string) {
  const missed = rounds.filter((round) => round.received && !(round.opened && round.fromClick === true)).length;
  const lostAfterPaint = rounds.filter((round) => !round.received && !round.sentBeforePaint).length;
  const reached = rounds.filter((round) => round.received).length;
  expectEqual(
    { missed, lostAfterPaint, mostReached: reached * 2 >= rounds.length },
    { missed: 0, lostAfterPaint: 0, mostReached: true },
    `${what}: every click the page received opened a tab its link script saw, every click that never reached the page was sent before the page's first contentful paint (Chromium drops input while it holds commits for that paint), and at least half reached the page (${reached} of ${rounds.length}) ${JSON.stringify(rounds)}`,
  );
}

const linkScriptChecks = (port: string): Check[] => [
  {
    name: "engine links: the link script sees the first click on a page that just woke from sleep",
    run: () =>
      withPages(
        ["first-click"],
        async ([page], windowId) => {
          await show(page!, windowId, LEFT);
          const rounds: Round[] = [];
          for (let i = 0; i < WAKES; i++) {
            await sleepOnce(page!, windowId, LINKS_TITLE);
            rounds.push(await clickAtOnce(page!));
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
            const host = i % 2 === 0 ? "localhost" : "127.0.0.1";
            const url = `http://${host}:${port}/links?round${i}`;
            await hostCall("tab.call", { key: page, method: "loadUrl", url });
            await until(`the page ${page} shows ${host}`, LOAD_MS, () => listed(page!), (tab) => String(tab?.url) === url && tab?.title === LINKS_TITLE && tab.loading === false);
            rounds.push(await clickAtOnce(page!));
          }
          judge(rounds, "clicks at once after a cross-process navigation");
        },
        "links",
        LINKS_TITLE,
      ),
  },
];

const port = engineAvailable() ? httpPagesPort() : null;

export const checks: Check[] = port ? linkScriptChecks(port) : [];
