import { hostCall } from "../engine/host";
import { mountPage } from "../engine/pages";
import { expectEqual, expectTrue, type Check } from "./check";
import { click, evaluate, firstWindow, LEFT, listed, pause, RIGHT, show, until } from "./engineSleep";
import { CTRL, DETACHED_MUTED_VIDEO, LOAD_MS, NEXT_LINK, PER_PAGE_COUNT, PLAY_BUTTON, SETTLE_MS, TOUCH_POINT, TRANSIENT_ACTIVATION_MS, blocked, countsOf, framed, held, loadedAt, mediaCommand, origin, played, playing, port, refusedThenStill, restore, setAutoplay, withMedia } from "./engineAutoplayKit";

const askChecks: Check[] = [
  {
    name: "engine autoplay: on a site that blocks nothing, a muted video Ardia's play control started keeps playing when the page unmutes it",
    run: () =>
      withMedia("control-unmute", "media?muted", "media page", async (key) => {
        await mediaCommand(key, "play");
        await until("Ardia's play control plays the muted video", SETTLE_MS, () => played(key), playing);
        await evaluate(key, 'm.muted = false; post("result", "true");');
        await pause(1000);
        expectEqual((await played(key)).paused, false, "the video keeps playing once the page unmutes it");
      }),
  },
  {
    name: "engine autoplay: Ardia's play toggle that pauses gives the page no user activation",
    run: () =>
      withMedia("toggle-pause", "media?auto-muted", "media page", async (key) => {
        await until("the muted autoplay plays", SETTLE_MS, () => played(key), playing);
        await mediaCommand(key, "toggle");
        await until("the toggle pauses it", SETTLE_MS, () => played(key), (state) => state.paused === true);
        expectEqual(await evaluate(key, 'post("result", JSON.stringify(navigator.userActivation.hasBeenActive));'), false, "the page's navigator.userActivation.hasBeenActive after a pausing toggle");
      }),
  },
  {
    name: "engine autoplay: media Ardia's play control started before blocking turned on keeps playing",
    run: async () => {
      try {
        await withMedia("control-then-block", "media?muted", "media page", async (key) => {
          await mediaCommand(key, "play");
          await until("Ardia's play control plays the muted video", SETTLE_MS, () => played(key), playing);
          await setAutoplay("block");
          await pause(1000);
          expectEqual((await played(key)).paused, false, "the video the user asked for through Ardia keeps playing after blocking turns on");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: media a click started before blocking turned on keeps playing",
    run: async () => {
      try {
        await withMedia("click-then-block", "media?muted", "media page", async (key) => {
          await click(key, PLAY_BUTTON.x, PLAY_BUTTON.y);
          await until("the click plays the muted video", SETTLE_MS, () => played(key), playing);
          await setAutoplay("block");
          await pause(1000);
          expectEqual((await played(key)).paused, false, "the video the user clicked keeps playing after blocking turns on");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: a Media Session play from the user lets the page's play handler play on a blocked site",
    run: async () => {
      try {
        await withMedia("session", "media?session", "media page", async (key) => {
          const started = await evaluate(key, 'm.play().then(() => "played", (error) => error.name).then((result) => post("result", JSON.stringify(result)));', true);
          expectEqual(started, "played", "the page plays with sound under a script gesture, so its media session has a player");
          await until("it plays", SETTLE_MS, () => played(key), playing);
          await evaluate(key, 'm.pause(); post("result", "true");');
          await setAutoplay("block");
          await pause(500);
          await hostCall("tab.call", { key, method: "mediaSessionActionForTest", action: "play" });
          const state = await until("the page's play handler answers", SETTLE_MS, () => played(key), (now) => (now.tries?.length ?? 0) > 0);
          expectEqual(state.tries, ["played"], "the play handler's play() after the user's Media Session play");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: a play() in a touch pointerdown handler plays on a blocked site",
    run: blocked(() =>
      withMedia("touch", "media?touchplay-muted", "media page", async (key) => {
        await hostCall("tab.call", { key, method: "touchForTest", x: TOUCH_POINT.x, y: TOUCH_POINT.y });
        const state = await until("the touch's play answers", SETTLE_MS, () => played(key), (now) => (now.tries?.length ?? 0) > 0);
        expectEqual(state.tries, ["played"], "play() inside the page's touch pointerdown handler");
      }),
    ),
  },
  {
    name: "engine autoplay: a play() on an iframe's video that is already playing is not counted as refused once the iframe's activation has expired",
    run: blocked(async () => {
      const count = countsOf("self-check-autoplay-again");
      try {
        await withMedia("again", "framed?quiet-same", "framed page", async (key) => {
          await until("the iframe reports", SETTLE_MS, () => framed(key), (state) => state.paused === true);
          const first = await evaluate(key, 'const media = document.querySelector("iframe").contentWindow.m; media.muted = true; media.play().then(() => "played", (error) => error.name).then((result) => post("result", JSON.stringify(result)));', true);
          expectEqual(first, "played", "the same-origin iframe plays under the top page's script gesture (transient activation)");
          await pause(TRANSIENT_ACTIVATION_MS);
          const before = count.total();
          const again = await evaluate(key, 'document.querySelector("iframe").contentWindow.m.play().then(() => "played", (error) => error.name).then((result) => post("result", JSON.stringify(result)));');
          await pause(1500);
          expectEqual({ again, counted: count.total() - before }, { again: "played", counted: 0 }, "play() again on the playing iframe video after the activation expired");
        });
      } finally {
        count.stop();
      }
    }),
  },
  {
    name: "engine autoplay: a page restored from the back/forward cache counts no more than 20 held plays in all",
    run: blocked(async () => {
      const count = countsOf("self-check-autoplay-page-count");
      try {
        await withMedia("page-count", "framed?same&burst", "framed page", async (key) => {
          await until("the first visit's count arrives", SETTLE_MS, async () => count.total(), (total) => total >= PER_PAGE_COUNT);
          await hostCall("tab.call", { key, method: "loadUrl", url: `${origin}/a` });
          await until("the next page loads", LOAD_MS, () => listed(key), (tab) => tab?.title === "loaded a");
          await hostCall("tab.call", { key, method: "goBack" });
          await until("the framed page is back", LOAD_MS, () => listed(key), (tab) => tab?.title === "framed page" && tab.loading === false);
          expectEqual(await evaluate(key, 'post("result", JSON.stringify(window.restored));'), true, "the framed page came back from the back/forward cache");
          await pause(2500);
          expectTrue(count.total() <= PER_PAGE_COUNT, `held plays counted for the page across its restore, at most ${PER_PAGE_COUNT}: ${JSON.stringify(count.counts)}`);
        });
      } finally {
        count.stop();
      }
    }),
  },
  {
    name: "engine autoplay: a background tab opened before its site was blocked follows the block once the app adopts it",
    run: async () => {
      const windowId = await firstWindow();
      const opener = "self-check-autoplay-late";
      const background = `${opener}-background`;
      const offered: string[] = [];
      const closeOpener = mountPage(opener, { url: `${origin}/media`, profile: "", windowId }, (name, data) => {
        const adopt = (data as { adoptId?: unknown } | null)?.adoptId;
        if (name === "openWindow" && typeof adopt === "string") offered.push(adopt);
      });
      let closeBackground: (() => void) | null = null;
      try {
        await loadedAt(opener, "/media", "media page");
        await show(opener, windowId, LEFT);
        await click(opener, NEXT_LINK.x, NEXT_LINK.y, CTRL);
        await until("the Ctrl+click's tab is offered to the page", SETTLE_MS, async () => offered.length, (count) => count > 0);
        await pause(1000);
        await setAutoplay("block");
        closeBackground = mountPage(background, { url: "", profile: "", adopt: offered[0], windowId }, () => {});
        await loadedAt(background, "/media?second", "media page");
        await show(background, windowId, RIGHT);
        await refusedThenStill(background, DETACHED_MUTED_VIDEO, "the adopted tab's muted play");
      } finally {
        closeBackground?.();
        closeOpener();
        await restore();
      }
    },
  },
];

export const checks: Check[] = port ? askChecks : [];
