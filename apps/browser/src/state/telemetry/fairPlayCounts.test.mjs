import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const fairPlay = await import("./fairPlayCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events
    .filter((e) => e.event === "usage_counts")
    .map((e) => ({
      played: e.properties.fairplay_played,
      license: e.properties.fairplay_failed_license,
      playback: e.properties.fairplay_failed_playback,
      player: e.properties.fairplay_failed_player,
      videoPlayed: e.properties.fairplay_video_played,
      videoLicense: e.properties.fairplay_video_failed_license,
      videoPlayback: e.properties.fairplay_video_failed_playback,
      videoPlayer: e.properties.fairplay_video_failed_player,
      mirrored: e.properties.fairplay_video_mirrored,
      mirrorResyncs: e.properties.fairplay_video_mirror_resyncs,
      youtubePlayed: e.properties.fairplay_youtube_played,
      youtubeLicense: e.properties.fairplay_youtube_failed_license,
      youtubePlayback: e.properties.fairplay_youtube_failed_playback,
      youtubePlayer: e.properties.fairplay_youtube_failed_player,
    }));
}

test("FairPlay bridge plays and failures are counted per step, unknown reports are ignored, sent on their own, then start again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  fairPlay.noteFairPlay({ event: "played" });
  fairPlay.noteFairPlay({ event: "played" });
  fairPlay.noteFairPlay({ event: "failed", step: "license" });
  fairPlay.noteFairPlay({ event: "failed", step: "player" });
  fairPlay.noteFairPlay({ event: "failed", step: "player" });
  fairPlay.noteFairPlay({ event: "failed", step: "somewhere" });
  fairPlay.noteFairPlay({ event: "failed" });
  fairPlay.noteFairPlay({ event: "paused" });
  fairPlay.noteFairPlay({ event: "played", video: true });
  fairPlay.noteFairPlay({ event: "failed", step: "playback", video: true });
  fairPlay.noteFairPlay({ event: "mirrored", video: true });
  fairPlay.noteFairPlay({ event: "mirrorResync", video: true });
  fairPlay.noteFairPlay({ event: "mirrorResync", video: true });
  fairPlay.noteFairPlay({ event: "mirrored" });
  fairPlay.noteFairPlay({ event: "played", video: true, site: "youtube" });
  fairPlay.noteFairPlay({ event: "played", video: true, site: "youtube" });
  fairPlay.noteFairPlay({ event: "failed", step: "license", video: true, site: "youtube" });
  fairPlay.noteFairPlay({ event: "failed", step: "player", video: true, site: "youtube" });
  usage.sessionEnding();
  assert.deepEqual(await sentUsageCounts(), [
    {
      played: 2,
      license: 1,
      playback: 0,
      player: 2,
      videoPlayed: 1,
      videoLicense: 0,
      videoPlayback: 1,
      videoPlayer: 0,
      mirrored: 1,
      mirrorResyncs: 2,
      youtubePlayed: 2,
      youtubeLicense: 1,
      youtubePlayback: 0,
      youtubePlayer: 1,
    },
  ]);

  usage.sessionEnding();
  assert.equal((await sentUsageCounts()).length, 1);
});
