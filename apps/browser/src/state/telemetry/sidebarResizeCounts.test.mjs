import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { noteSidebarResize } = await import("./sidebarResizeCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sentSidebarResizes() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events.filter((e) => e.event === "usage_counts").map((e) => e.properties.sidebar_resizes);
}

test("an hour with only sidebar resizes still sends usage_counts, and the count starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  noteSidebarResize();
  noteSidebarResize();
  usage.sessionEnding();
  assert.deepEqual(await sentSidebarResizes(), [2]);

  usage.sessionEnding();
  assert.deepEqual(await sentSidebarResizes(), [2]);
});

test("pinned-section toggles send only aggregate collapse and expand counts while sharing is on", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const { togglePinnedFold } = await import("../sidebar/pinnedFold.ts");
  useBrowser.getState().hydrate({});
  client.setSharing(false, "settings");
  togglePinnedFold("default");
  client.setSharing(true, "settings");
  togglePinnedFold("default");
  togglePinnedFold("default");
  usage.sessionEnding();
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json"));
  const fields = saved.events.filter((e) => e.event === "usage_counts").at(-1).properties;
  assert.equal(fields.pinned_section_collapses, 1);
  assert.equal(fields.pinned_section_expands, 1);
  client.setSharing(false, "settings");
});

test("turning sharing off discards pending pinned-section counts", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const { togglePinnedFold } = await import("../sidebar/pinnedFold.ts");
  const { takeSidebarResizeCounts } = await import("./sidebarResizeCounts.ts");
  useBrowser.getState().hydrate({});
  client.setSharing(true, "settings");
  togglePinnedFold("default");
  togglePinnedFold("missing-profile");
  client.setSharing(false, "settings");
  const fields = takeSidebarResizeCounts();
  assert.equal(fields.pinned_section_collapses, 0);
  assert.equal(fields.pinned_section_expands, 0);
});
