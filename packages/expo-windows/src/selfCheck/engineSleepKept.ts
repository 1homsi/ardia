import { engineAvailable, hostCall, leaveOffersFromUnheard } from "../engine/host";
import { expectEqual, expectTrue, type Check } from "./check";
import { click, evaluate, hide, keptBy, LEFT, listed, RIGHT, show, until, withPages } from "./engineSleep";

const AUDIBLE = 5;
const RECENTLY_AUDIBLE = 6;
const OPENS_LIVE_PAGE = 100;
const UNSAVED_AFTER_USE = 101;
const HOLDS_WEB_LOCK = 102;
const LIVE_CONNECTION = 104;
const INSPECTED_BY_ANOTHER_CLIENT = 105;
const SIGNAL_MS = 5000;
const UNHEARD_POPUP = "ardia-sleep-check-unheard";

const keptWithin = (key: string, code: number | number[], what: string) => {
  const wanted = Array.isArray(code) ? code : [code];
  return until(what, SIGNAL_MS, () => keptBy(key, 0), (kept) => Array.isArray(kept) && kept.some((each) => wanted.includes(each as number)));
};

const sleepsWithin = (key: string, what: string) => until(what, SIGNAL_MS, () => keptBy(key, 0), (kept) => Array.isArray(kept) && kept.length === 0);

const BEFORE_UNLOAD = `addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; }); post("result", "null");`;

const keptChecks: Check[] = [
  {
    name: "engine sleep: a hidden page with a beforeunload handler the user has used is kept; the same page nobody used sleeps",
    run: () =>
      withPages(["unsaved", "untouched"], async ([unsaved, untouched], windowId) => {
        await show(unsaved!, windowId, LEFT);
        await show(untouched!, windowId, RIGHT);
        await evaluate(unsaved!, BEFORE_UNLOAD);
        await evaluate(untouched!, BEFORE_UNLOAD);
        await click(unsaved!, 150, 160);
        await hide(unsaved!, windowId);
        await hide(untouched!, windowId);
        await keptWithin(unsaved!, UNSAVED_AFTER_USE, `the used page is kept for its beforeunload (${UNSAVED_AFTER_USE})`);
        expectEqual(await sleepsWithin(untouched!, "the page nobody used sleeps despite its beforeunload"), [], "the untouched page");
        expectEqual((await listed(unsaved!))?.discarded, false, "the used page is still loaded");
      }),
  },
  {
    name: "engine sleep: a hidden page holding a Web Lock is kept",
    run: () =>
      withPages(["lock"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        await evaluate(page!, `navigator.locks.request("ardia-sleep-check", () => new Promise(() => {})); post("result", "null");`);
        await hide(page!, windowId);
        await keptWithin(page!, HOLDS_WEB_LOCK, `kept while it holds a Web Lock (${HOLDS_WEB_LOCK})`);
      }),
  },
  {
    name: "engine sleep: a hidden page with a WebRTC data channel is kept as in use",
    run: () =>
      withPages(["rtc"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        await evaluate(page!, `window.ardiaPeer = new RTCPeerConnection(); window.ardiaChannel = window.ardiaPeer.createDataChannel("ardia"); post("result", "null");`);
        await hide(page!, windowId);
        await keptWithin(page!, LIVE_CONNECTION, `kept while it has a live connection (${LIVE_CONNECTION})`);
      }),
  },
  {
    name: "engine sleep: a hidden page another DevTools client is attached to is kept, and sleeps once that client detaches",
    run: () =>
      withPages(["client"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        await hide(page!, windowId);
        await hostCall("tab.call", { key: page!, method: "testClient", attach: true });
        let attached = true;
        try {
          await keptWithin(page!, INSPECTED_BY_ANOTHER_CLIENT, `kept while another DevTools client is attached (${INSPECTED_BY_ANOTHER_CLIENT})`);
          await hostCall("tab.call", { key: page!, method: "testClient", attach: false });
          attached = false;
          expectEqual(await sleepsWithin(page!, "the page sleeps once the client detaches"), [], "after the client detached");
        } finally {
          if (attached) await hostCall("tab.call", { key: page!, method: "testClient", attach: false }).catch(() => null);
        }
      }),
  },
  {
    name: "engine sleep: the opener of a pop-up still waiting as an offer the app hasn't taken is kept",
    run: () =>
      withPages(["offer"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        leaveOffersFromUnheard(page!);
        try {
          expectEqual(await evaluate(page!, `post("result", JSON.stringify(!!window.open("about:blank", "${UNHEARD_POPUP}", "width=320,height=240")));`, true), true, "window.open returns a window");
          await hide(page!, windowId);
          await keptWithin(page!, OPENS_LIVE_PAGE, `kept as the opener of a pending offer (${OPENS_LIVE_PAGE})`);
        } finally {
          leaveOffersFromUnheard(null);
          await evaluate(page!, `const w = window.open("", "${UNHEARD_POPUP}"); if (w) w.close(); post("result", "null");`).catch(() => null);
        }
      }),
  },
  {
    name: "engine sleep: a hidden page playing sound is kept as audible",
    run: () =>
      withPages(["audible"], async ([page], windowId) => {
        await show(page!, windowId, LEFT);
        const started = await evaluate(
          page!,
          `const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0.05; o.connect(g).connect(c.destination); o.start(); window.ardiaTone = c; c.resume().then(() => post("result", JSON.stringify(c.state)));`,
          true,
        );
        expectEqual(started, "running", "the tone's audio context");
        await hide(page!, windowId);
        const kept = await keptWithin(page!, [AUDIBLE, RECENTLY_AUDIBLE], `kept while audible (${AUDIBLE} or ${RECENTLY_AUDIBLE})`);
        expectTrue(Array.isArray(kept), "an answer");
      }),
  },
];

export const checks: Check[] = engineAvailable() ? keptChecks : [];
