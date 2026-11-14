import assert from "node:assert/strict";
import { test } from "node:test";
import { createBudgetProbe, initialState, judge, LOOK_BUDGET, mode, parseState, record, refresh, wantsMeasurement, type BudgetState, type FrameSample } from "../../../../packages/phone/src/lookBudgetRules.ts";

const frames = (count: number, totalMs: number, deadlineMs = 16.6): FrameSample => ({ totals: Array(count).fill(totalMs), deadlines: Array(count).fill(deadlineMs) });
const over = judge(frames(50, 40));
const within = judge(frames(50, 9));
const noSystem = { reduceMotion: false, reduceTransparency: false };
const day = 24 * 60 * 60 * 1000;

test("a sample is over when its median frame misses the deadline or a quarter of its frames do, and too few frames decide nothing", () => {
  assert.equal(over.over, true);
  assert.equal(within.over, false);
  const mostlyFast: FrameSample = { totals: [...Array(36).fill(8), ...Array(14).fill(30)], deadlines: Array(50).fill(16.6) };
  assert.equal(judge(mostlyFast).over, true, "28% missed although the median is fast");
  const fewMissed: FrameSample = { totals: [...Array(40).fill(8), ...Array(10).fill(30)], deadlines: Array(50).fill(16.6) };
  assert.equal(judge(fewMissed).over, false, "20% missed is within");
  const short = judge(frames(LOOK_BUDGET.minFrames - 1, 40));
  assert.equal(short.conclusive, false);
  assert.equal(short.over, false);
});

test("one bad measurement never degrades; two on separate deck opens do, and the look changes only for the next build", () => {
  let state = initialState("1");
  state = record(state, over, 1000);
  assert.equal(state.apply, "full");
  assert.equal(state.pendingOver, true);
  state = record(state, over, 2000);
  assert.equal(state.verdict, "fail");
  assert.equal(state.apply, "degraded");
  assert.equal(state.measuredAt, 2000);
});

test("a good measurement between two bad ones starts the agreement over", () => {
  let state = record(initialState("1"), over, 1000);
  state = record(state, within, 2000);
  assert.equal(state.verdict, "pass");
  assert.equal(state.pendingOver, false);
  state = refresh(state, "2", 3000);
  state = record(state, over, 4000);
  assert.equal(state.apply, "full");
});

test("an inconclusive sample changes nothing", () => {
  const before = record(initialState("1"), over, 1000);
  assert.deepEqual(record(before, judge(frames(3, 40)), 2000), before);
});

test("the verdict is kept per version: a pass is not measured again until the app updates", () => {
  let state = record(initialState("1"), within, 1000);
  assert.equal(wantsMeasurement(state, noSystem), false);
  state = refresh(state, "1", 1000 + 400 * day);
  assert.equal(wantsMeasurement(state, noSystem), false);
  state = refresh(state, "2", 1000 + 400 * day);
  assert.equal(state.verdict, "unknown");
  assert.equal(wantsMeasurement(state, noSystem), true);
});

test("a degraded phone gets a second chance after an update or thirty days, shown the full look to measure it", () => {
  const failed = record(record(initialState("1"), over, 1000), over, 2000);
  assert.equal(wantsMeasurement(failed, noSystem), false, "degraded: nothing to measure");
  assert.deepEqual(refresh(failed, "1", 2000 + 29 * day), failed);
  const later = refresh(failed, "1", 2000 + LOOK_BUDGET.retryAfterMs);
  assert.equal(later.apply, "full");
  assert.equal(wantsMeasurement(later, noSystem), true);
  const updated = refresh(failed, "2", 3000);
  assert.equal(updated.apply, "full");
  assert.equal(updated.version, "2");
  const passed = record(updated, within, 4000);
  assert.equal(passed.verdict, "pass");
});

test("a trial already under way survives a relaunch, so its two measurements can still agree", () => {
  const failed = record(record(initialState("1"), over, 1000), over, 2000);
  let trial = refresh(failed, "2", 3000);
  trial = record(trial, over, 4000);
  assert.equal(trial.pendingOver, true);
  const relaunched = refresh(trial, "2", 5000);
  assert.equal(relaunched.pendingOver, true);
  assert.equal(record(relaunched, over, 6000).apply, "degraded");
});

test("the system settings win: they always turn their half off, and the measurement can only take the look away", () => {
  assert.equal(mode("full", noSystem), "full");
  assert.equal(mode("full", { reduceMotion: true, reduceTransparency: false }), "no_motion");
  assert.equal(mode("full", { reduceMotion: false, reduceTransparency: true }), "no_blur");
  assert.equal(mode("full", { reduceMotion: true, reduceTransparency: true }), "neither");
  assert.equal(mode("degraded", noSystem), "neither");
  assert.equal(wantsMeasurement(initialState("1"), { reduceMotion: true, reduceTransparency: false }), false, "nothing moves to measure");
});

test("a stored state that is missing or damaged starts over", () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState("{"), null);
  assert.equal(parseState(JSON.stringify({ version: "1", verdict: "maybe", apply: "full" })), null);
  const kept: BudgetState = record(initialState("1"), over, 1000);
  assert.deepEqual(parseState(JSON.stringify(kept)), kept);
  assert.deepEqual(refresh(null, "3", 0), initialState("3"));
});

function fakeProbe() {
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  let now = 0;
  const asked: number[] = [];
  const recorded: FrameSample[] = [];
  let answer: (sample: FrameSample | null) => void = () => undefined;
  const probe = createBudgetProbe({
    sample: (millis) => {
      asked.push(now);
      assert.equal(millis, LOOK_BUDGET.sampleMs);
      return new Promise((resolve) => (answer = resolve));
    },
    schedule: (run, millis) => {
      const timer = { at: now + millis, run, cancelled: false };
      timers.push(timer);
      return () => (timer.cancelled = true);
    },
    record: (sample) => recorded.push(sample),
  });
  const advance = (millis: number) => {
    now += millis;
    for (const timer of timers.filter((t) => !t.cancelled && t.at <= now)) {
      timer.cancelled = true;
      timer.run();
    }
  };
  const settle = async (sample: FrameSample | null) => {
    answer(sample);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { probe, advance, settle, asked, recorded };
}

test("the probe skips the first second after the deck shows and samples only while it stays idle", async () => {
  const { probe, advance, settle, asked, recorded } = fakeProbe();
  probe.update(true, true);
  advance(LOOK_BUDGET.skipAfterShownMs - 1);
  assert.deepEqual(asked, []);
  advance(1);
  assert.deepEqual(asked, [LOOK_BUDGET.skipAfterShownMs]);
  await settle(frames(50, 9));
  assert.equal(recorded.length, 1);
});

test("the deck stopping being idle cancels the wait, and a sample already running is dropped", async () => {
  const { probe, advance, settle, asked, recorded } = fakeProbe();
  probe.update(true, true);
  advance(500);
  probe.update(false, true);
  advance(2000);
  assert.deepEqual(asked, []);
  probe.update(true, true);
  advance(LOOK_BUDGET.skipAfterShownMs);
  assert.equal(asked.length, 1);
  probe.update(false, true);
  await settle(frames(50, 40));
  assert.equal(recorded.length, 0, "the sample overlapped a scroll or a sheet");
});

test("one deck open gives at most one measurement, and a phone that needs none is never sampled", async () => {
  const { probe, advance, settle, asked, recorded } = fakeProbe();
  probe.update(true, true);
  advance(LOOK_BUDGET.skipAfterShownMs);
  await settle(frames(50, 40));
  probe.update(false, true);
  probe.update(true, true);
  advance(10_000);
  assert.equal(asked.length, 1);
  assert.equal(recorded.length, 1);
  const quiet = fakeProbe();
  quiet.probe.update(true, false);
  quiet.advance(10_000);
  assert.deepEqual(quiet.asked, []);
});
