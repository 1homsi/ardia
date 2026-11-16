import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const placement = await import("./windowPlacementCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sentPlacementCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events.filter((e) => e.event === "usage_counts").map((e) => [e.properties.window_centered_resizes, e.properties.windows_reopened_maximized]);
}

test("an hour with only Option resizes still sends usage_counts, and the count starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  stub.emitAppEvent({ type: "centeredResize" });
  stub.emitAppEvent({ type: "centeredResize" });
  usage.sessionEnding();
  assert.deepEqual(await sentPlacementCounts(), [[2, 0]]);

  usage.sessionEnding();
  assert.deepEqual(await sentPlacementCounts(), [[2, 0]]);
});

test("an hour with only drags Ardia moved itself still sends usage_counts with how many, and the count starts again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  const sentDragLoops = async () => {
    await client.saveQueueNow();
    const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
    return saved.events.filter((e) => e.event === "usage_counts").map((e) => e.properties.window_drag_loops);
  };
  const before = (await sentDragLoops()).length;

  stub.emitAppEvent({ type: "windowDragLoop" });
  stub.emitAppEvent({ type: "windowDragLoop" });
  stub.emitAppEvent({ type: "windowDragLoop" });
  usage.sessionEnding();
  assert.equal((await sentDragLoops()).at(-1), 3);

  usage.sessionEnding();
  assert.equal((await sentDragLoops()).length, before + 1, "an hour with no drag sends nothing more");
});

test("an hour with only a window reopened maximized still sends usage_counts", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");

  placement.noteWindowReopenedMaximized();
  usage.sessionEnding();
  assert.deepEqual((await sentPlacementCounts()).at(-1), [0, 1]);
});
