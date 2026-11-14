import assert from "node:assert/strict";
import { test } from "node:test";
import { submitRepeatsKey } from "./actions.ts";
import { noteFind, takeFindCounts } from "../telemetry/findCounts.ts";

test("a submit right after the Enter keydown it came from doesn't step again, a later one does", () => {
  assert.equal(submitRepeatsKey(1000, 1000), true);
  assert.equal(submitRepeatsKey(1000, 1100), true);
  assert.equal(submitRepeatsKey(1000, 1300), false);
  assert.equal(submitRepeatsKey(0, 5000), false);
});

test("find opens and steps are counted and reset once taken", () => {
  takeFindCounts();
  noteFind("opened");
  noteFind("stepped");
  noteFind("stepped");
  assert.deepEqual(takeFindCounts(), { find_opens: 1, find_steps: 2 });
  assert.deepEqual(takeFindCounts(), { find_opens: 0, find_steps: 0 });
});
