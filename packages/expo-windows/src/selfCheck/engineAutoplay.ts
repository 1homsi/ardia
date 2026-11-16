import { engineAvailable, engineCallJson, hostCall } from "../engine/host";
import { httpPagesPort } from "./engineBackForward";
import { expectEqual, expectTrue, type Check } from "./check";
import { click, evaluate, firstWindow, heard, LEFT, listed, show, until } from "./engineSleep";

const SETTLE_MS = 6000;
const LOAD_MS = 20000;
const PLAY_BUTTON = { x: 100, y: 130 };

type Played = { paused?: boolean; time?: number; tries?: string[] };

const port = engineAvailable() ? httpPagesPort() : null;
const origin = `http://127.0.0.1:${port}`;

async function setAutoplay(value: "allow" | "block" | "default") {
  const reply = JSON.parse(await engineCallJson("ac_site_settings_set", "", JSON.stringify({ origin, type: "autoplay", value }))) as { error?: unknown };
  expectEqual(reply.error, undefined, `Autoplay set to ${value} for ${origin}`);
}

const blockEverywhere = (enabled: boolean) => hostCall<{ everywhere?: unknown }>("autoplay.everywhere", { enabled });

async function withMedia(name: string, path: string, title: string, run: (key: string) => Promise<void>) {
  const key = `self-check-autoplay-${name}`;
  const windowId = await firstWindow();
  try {
    await hostCall("tab.create", { key, url: `${origin}/${path}`, profile: "" }, windowId);
    await show(key, windowId, LEFT);
    await until(`the page ${key} loads`, LOAD_MS, () => listed(key), (tab) => tab?.title === title && tab.loading === false);
    await run(key);
  } finally {
    await hostCall("tab.close", { key }).catch(() => null);
  }
}

const played = async (key: string) => ((await evaluate(key, "JSON.stringify({ paused: m.paused, time: m.currentTime, tries })")) ?? {}) as Played;
const framed = async (key: string) => ((await evaluate(key, "JSON.stringify(frameState || {})")) ?? {}) as Played;
const playing = (state: Played) => state.paused === false && (state.time ?? 0) > 0.3;
const held = (state: Played) => state.paused === true && (state.tries?.length ?? 0) > 0;
const blockedHeard = (key: string, what: string) => heard("tab", (event) => event.key === key && event.name === "autoplayBlocked" && Number(event.data?.count) > 0, what);

async function restore() {
  await blockEverywhere(false).catch(() => null);
  await engineCallJson("ac_site_settings_set", "", JSON.stringify({ origin, type: "autoplay", value: "default" })).catch(() => null);
}

const autoplayChecks: Check[] = [
  {
    name: "engine autoplay: a site set to Block gets no sound autoplay, and the held play is counted",
    run: async () => {
      try {
        await setAutoplay("block");
        const counted = blockedHeard("self-check-autoplay-sound", "a counted blocked play with sound");
        await withMedia("sound", "media?auto", "media page", async (key) => {
          const state = await until("the sound play is refused", SETTLE_MS, () => played(key), held);
          expectEqual(state.tries, ["NotAllowedError"], "play() with sound is refused as Chrome refuses a play nobody asked for");
          await counted;
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: a site set to Block gets no muted autoplay either, and the held play is counted",
    run: async () => {
      try {
        await setAutoplay("block");
        const counted = blockedHeard("self-check-autoplay-muted", "a counted blocked muted play");
        await withMedia("muted", "media?auto-muted", "media page", async (key) => {
          await until("the muted autoplay is paused", SETTLE_MS, () => played(key), held);
          await counted;
          expectTrue(!playing(await played(key)), "the muted video stays paused");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: on a blocked site a click on the page's play button plays with sound",
    run: async () => {
      try {
        await setAutoplay("block");
        await withMedia("click", "media?auto-muted", "media page", async (key) => {
          await until("the muted autoplay is paused before the click", SETTLE_MS, () => played(key), held);
          await click(key, PLAY_BUTTON.x, PLAY_BUTTON.y);
          await evaluate(key, "JSON.stringify(m.muted = false)");
          const state = await until("the clicked play plays", SETTLE_MS, () => played(key), playing);
          expectEqual(state.tries?.at(-1), "played", "the click's play() resolves");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: a cross-site iframe on a blocked site gets no muted autoplay",
    run: async () => {
      try {
        await setAutoplay("block");
        const counted = blockedHeard("self-check-autoplay-frame", "a counted blocked play in the iframe");
        await withMedia("frame", "framed", "framed page", async (key) => {
          await until("the iframe reports its video", SETTLE_MS, () => framed(key), (state) => (state.tries?.length ?? 0) > 0);
          await until("the iframe's muted autoplay is paused", SETTLE_MS, () => framed(key), held);
          await counted;
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: turning Block autoplay everywhere on pauses autoplay in an open tab without a reload",
    run: async () => {
      try {
        await withMedia("open", "media?auto-muted", "media page", async (key) => {
          await until("the muted autoplay plays while nothing blocks it", SETTLE_MS, () => played(key), playing);
          const counted = blockedHeard(key, "a counted pause in the open tab");
          expectEqual((await blockEverywhere(true)).everywhere, true, "the engine took Block autoplay everywhere");
          await until("the open tab's video is paused", SETTLE_MS, () => played(key), (state) => state.paused === true);
          await counted;
          expectEqual((await played(key)).tries, ["played"], "the page was not reloaded");
        });
      } finally {
        await restore();
      }
    },
  },
  {
    name: "engine autoplay: with Block autoplay everywhere on, a site set to Allow still autoplays",
    run: async () => {
      try {
        expectEqual((await blockEverywhere(true)).everywhere, true, "the engine took Block autoplay everywhere");
        await setAutoplay("allow");
        await withMedia("allowed", "media?auto-muted", "media page", async (key) => {
          await until("the allowed site's muted autoplay plays", SETTLE_MS, () => played(key), playing);
        });
      } finally {
        await restore();
      }
    },
  },
];

export const checks: Check[] = port ? autoplayChecks : [];
