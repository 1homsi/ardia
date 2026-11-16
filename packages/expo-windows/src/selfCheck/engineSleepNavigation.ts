import { engineAvailable } from "../engine/host";
import { expectTrue, type Check } from "./check";
import { evaluate, hide, keptBy, LEFT, listed, pause, show, until, withPages } from "./engineSleep";

const SIGNAL_MS = 8000;
const AFTER_WAKE_MS = 3000;

const navigationChecks: Check[] = [
  {
    name: "engine sleep: a hidden page's navigation in flight survives a sleep request, and the page wakes still on its way there",
    run: () =>
      withPages(["navigation"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        await hide(page!, windowId);
        await evaluate(page!, `setTimeout(() => { location.href = "/hold?navigation"; }, 0); post("result", "null");`);
        await until("the hidden page reports its navigation as loading", SIGNAL_MS, () => listed(page!), (tab) => tab?.loading === true);
        const kept = await keptBy(page!, 0);
        await show(page!, windowId, LEFT);
        await pause(AFTER_WAKE_MS);
        const after = await listed(page!);
        expectTrue(after?.loading === true && after?.discarded !== true, `after a sleep request and a wake the page is still waiting for /hold (sleepIfHidden answered ${JSON.stringify(kept)}; now ${JSON.stringify(after)})`);
      }),
  },
];

export const checks: Check[] = engineAvailable() ? navigationChecks : [];
