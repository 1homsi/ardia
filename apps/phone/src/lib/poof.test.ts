import assert from "node:assert/strict";
import test from "node:test";
import { POOF, poofPuff } from "./poof.ts";

test("the poof is Compose's PoofBurst: nine puffs flying out and growing, and a centre puff shrinking by half", () => {
  const start = poofPuff(0, 0, 100);
  const end = poofPuff(0, 1, 100);
  assert.ok(Math.abs(Math.hypot(start.dx, start.dy) - 46 * 0.35) < 1e-9);
  assert.ok(Math.abs(Math.hypot(end.dx, end.dy) - 46) < 1e-9);
  assert.ok(Math.abs(end.radius - 20 * 1.2) < 1e-9);
  assert.equal(poofPuff(1, 1, 100).radius, 15 * 1.2);
  assert.equal(poofPuff(POOF.count, 0, 100).radius, 21);
  assert.equal(poofPuff(POOF.count, 1, 100).radius, 10.5);
});
