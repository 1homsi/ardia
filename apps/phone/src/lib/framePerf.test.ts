import assert from "node:assert/strict";
import test from "node:test";
import { interactionLine, summarizeFrames } from "./framePerf.ts";

test("a frame summary gives the median, the 90th percentile, the worst frame and the frames over one and a half budgets", () => {
  const summary = summarizeFrames([16.7, 16.7, 16.7, 33.3, 16.7, 50, 16.7, 16.7, 16.7, 16.7]);
  assert.equal(summary.frames, 10);
  assert.equal(summary.p50, 16.7);
  assert.equal(summary.p90, 33.3);
  assert.equal(summary.max, 50);
  assert.equal(summary.overBudget, 2);
  assert.deepEqual(summarizeFrames([]), { frames: 0, p50: 0, p90: 0, max: 0, overBudget: 0 });
  assert.equal(summarizeFrames([0, -1, Number.NaN, 20]).frames, 1);
});

test("an interaction prints one lab line with both threads and the renders by component", () => {
  const js = summarizeFrames([16.7, 33.3]);
  const ui = summarizeFrames([16.7, 16.7]);
  assert.equal(
    interactionLine("card open", 900, js, ui, new Map([["TabDeck", 2], ["DeckCard", 18]])),
    "PAGELAB perf card open 900ms | js 2 frames p50 16.7 p90 33.3 max 33.3 slow 1 | ui 2 frames p50 16.7 p90 16.7 max 16.7 slow 0 | renders 20 (DeckCard=18 TabDeck=2)",
  );
  assert.equal(interactionLine("tray open", 800, js, null, new Map()), "PAGELAB perf tray open 800ms | js 2 frames p50 16.7 p90 33.3 max 33.3 slow 1 | ui unmeasured | renders 0");
});
