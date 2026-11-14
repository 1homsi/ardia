import assert from "node:assert/strict";
import test from "node:test";
import { neighbourAt, neighbours } from "./pagerPhysics.ts";

test("a step goes delta places along the swipe order, as Compose's SwipeOrder.neighbor does, and off either end it goes nowhere", () => {
  const order = ["a", "b", "c", "d"];
  assert.equal(neighbourAt(order, "b", 1), "c");
  assert.equal(neighbourAt(order, "b", -1), "a");
  assert.equal(neighbourAt(order, "b", 2), "d");
  assert.equal(neighbourAt(order, "d", 1), null);
  assert.equal(neighbourAt(order, "x", 1), null);
  assert.deepEqual(neighbours(order, "a"), { left: null, right: "b" });
});
