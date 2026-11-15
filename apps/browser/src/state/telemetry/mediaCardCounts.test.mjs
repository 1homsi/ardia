import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { noteSidebarPlayerExpand, takeMediaCardCounts } = await import("./mediaCardCounts.ts");
after(() => client.setSharing(false, "settings"));

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("a Playing now card opened while it was still closing counts as an open and a reopen", () => {
  noteSidebarPlayerExpand(false);
  noteSidebarPlayerExpand(true);
  noteSidebarPlayerExpand(false);
  assert.deepEqual(takeMediaCardCounts(), { sidebar_player_expands: 3, sidebar_player_reopens: 1, now_playing_loop_restarts: 0 });
  assert.deepEqual(takeMediaCardCounts(), { sidebar_player_expands: 0, sidebar_player_reopens: 0, now_playing_loop_restarts: 0 });
});

test("an hour with only reopens counted still sends usage_counts with both counts", async () => {
  client.setSharing(true, "onboarding");
  noteSidebarPlayerExpand(true);
  usage.sessionEnding();
  const sent = await usageCounts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sidebar_player_expands, 1);
  assert.equal(sent[0].sidebar_player_reopens, 1);
});
