import assert from "node:assert/strict";
import test from "node:test";
import { serialQueue } from "./serialQueue.ts";

test("queued work runs one at a time in arrival order, so a slow earlier action can't finish after a later one", async () => {
  const seen: string[] = [];
  const push = serialQueue();
  let releaseInbox = () => {};
  push(async () => {
    seen.push("inbox-start");
    await new Promise<void>((done) => (releaseInbox = done));
    seen.push("deck");
  });
  const open = push(async () => {
    seen.push("open");
  });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(seen, ["inbox-start"]);
  releaseInbox();
  await open;
  assert.deepEqual(seen, ["inbox-start", "deck", "open"]);
});

test("a failed action doesn't stop the ones after it", async () => {
  const seen: string[] = [];
  const push = serialQueue();
  push(async () => {
    throw new Error("inbox");
  });
  await push(async () => {
    seen.push("open");
  });
  assert.deepEqual(seen, ["open"]);
});
