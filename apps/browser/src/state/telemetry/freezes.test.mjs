import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const { NativeModules } = await import("react-native");
const emptyTally = () => ({ buckets: [0, 0, 0, 0, 0, 0], longestMs: 0, inputWaits: 0, inputWaitMaxMs: 0, gcMeasured: 0, gcMs: 0, gcLongestMs: 0, gcBound: 0 });
const BUCKET_FLOORS = [250, 500, 1000, 2000, 5000, 10000];

const native = {
  epoch: 0,
  starts: 0,
  tally: { main: emptyTally(), js: emptyTally() },
  start() {
    this.starts++;
    return true;
  },
  setConsentEpoch(epoch) {
    this.epoch = epoch;
    this.tally = { main: emptyTally(), js: emptyTally() };
    return true;
  },
  stall(thread, ms, { epoch = this.epoch, inputWaitMs = 0, gcMs = -1 } = {}) {
    if (!epoch || epoch !== this.epoch) return;
    const t = this.tally[thread];
    t.buckets[BUCKET_FLOORS.findLastIndex((floor) => ms >= floor)]++;
    t.longestMs = Math.max(t.longestMs, ms);
    if (inputWaitMs >= 50) {
      t.inputWaits++;
      t.inputWaitMaxMs = Math.max(t.inputWaitMaxMs, inputWaitMs);
    }
    if (gcMs >= 0) {
      t.gcMeasured++;
      t.gcMs += gcMs;
      t.gcLongestMs = Math.max(t.gcLongestMs, gcMs);
      if (gcMs * 2 >= ms) t.gcBound++;
    }
  },
  take(epoch) {
    if (!epoch || epoch !== this.epoch) return null;
    const taken = this.tally;
    this.tally = { main: emptyTally(), js: emptyTally() };
    return taken;
  },
};
NativeModules.ACFreezeWatch = native;

let hermes = { js_numGCs: 10, js_gcTime: 1.5, js_heapSize: 200 * 1_048_576 };
globalThis.HermesInternal = { getInstrumentedStats: () => ({ ...hermes }) };

const client = await import("./client.ts");
const freezes = await import("./freezes.ts");
after(() => client.setSharing(false, "settings"));

beforeEach(() => {
  client.loadChoice();
  client.setSharing(false, "settings");
});

test("the watch starts once and follows the sharing choice with a new epoch each time sharing turns on", () => {
  assert.equal(freezes.startFreezeWatch(), true);
  assert.equal(freezes.startFreezeWatch(), false, "a second start is a no-op");
  assert.equal(native.starts, 1);
  assert.equal(native.epoch, 0);
  client.setSharing(true, "settings");
  const first = native.epoch;
  assert.ok(first > 0);
  client.setSharing(false, "settings");
  assert.equal(native.epoch, 0);
  client.setSharing(true, "settings");
  assert.ok(native.epoch > 0 && native.epoch !== first);
});

test("each stall lands in its duration bucket, with the longest stall, input waits and the JS thread's GC share", () => {
  client.setSharing(true, "settings");
  freezes.takeFreezeCounts();
  for (const ms of [300, 499, 700, 1200, 2500, 6000, 31_000]) native.stall("main", ms);
  native.stall("main", 400, { inputWaitMs: 380 });
  native.stall("js", 1200, { gcMs: 900, inputWaitMs: 40 });
  native.stall("js", 6000, { gcMs: 100, inputWaitMs: 5800 });
  native.stall("js", 300);
  const sent = freezes.takeFreezeCounts();
  assert.deepEqual(
    Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith("main_"))),
    {
      main_stall_250_500ms: 3,
      main_stall_500ms_1s: 1,
      main_stall_1_2s: 1,
      main_stall_2_5s: 1,
      main_stall_5_10s: 1,
      main_stall_over_10s: 1,
      main_stall_longest_ms: 31_000,
      main_stall_input_waits: 1,
      main_stall_input_wait_max_ms: 380,
    },
  );
  assert.equal(sent.js_stall_250_500ms, 1);
  assert.equal(sent.js_stall_1_2s, 1);
  assert.equal(sent.js_stall_5_10s, 1);
  assert.equal(sent.js_stall_longest_ms, 6000);
  assert.equal(sent.js_stall_input_waits, 1, "a 40 ms wait isn't an input held by the stall");
  assert.equal(sent.js_stall_input_wait_max_ms, 5800);
  assert.equal(sent.js_stall_gc_measured, 2);
  assert.equal(sent.js_stall_gc_ms, 1000);
  assert.equal(sent.js_stall_gc_longest_ms, 900);
  assert.equal(sent.js_stall_gc_bound, 1, "only the stall that was mostly collection is GC-bound");
  assert.equal(freezes.takeFreezeCounts().main_stall_250_500ms, 0, "taken once");
});

test("Hermes's collections in the period: count, time and the heap's size floor", () => {
  hermes = { js_numGCs: 10, js_gcTime: 1.5, js_heapSize: 200 * 1_048_576 };
  client.setSharing(true, "settings");
  hermes = { js_numGCs: 14, js_gcTime: 2.75, js_heapSize: 300 * 1_048_576 };
  const sent = freezes.takeFreezeCounts();
  assert.equal(sent.js_gc_count, 4);
  assert.equal(sent.js_gc_ms, 1250);
  assert.equal(sent.js_heap_mb_floor, 256);
  assert.deepEqual([0, 63, 64, 1023, 1024, 5000].map((mb) => freezes.heapFloorMb(mb * 1_048_576)), [0, 0, 64, 512, 1024, 2048]);
});

test("nothing from while sharing was off is sent: stalls, collections and hangs from then are dropped", () => {
  hermes = { js_numGCs: 10, js_gcTime: 1, js_heapSize: 1 };
  native.stall("main", 6000, { epoch: 0 });
  freezes.noteRendererUnresponsive("tab-off", 0);
  assert.deepEqual(freezes.takeFreezeCounts(), {}, "sharing off sends nothing");
  hermes = { js_numGCs: 50, js_gcTime: 9, js_heapSize: 1 };
  client.setSharing(true, "settings");
  const stale = native.epoch;
  freezes.noteRendererResponsive("tab-off", false, 3000);
  const sent = freezes.takeFreezeCounts();
  assert.equal(sent.main_stall_5_10s, 0);
  assert.equal(sent.renderer_unresponsive, 0);
  assert.equal(sent.js_gc_count, 0, "collections before sharing turned on aren't counted");
  native.stall("js", 2000, { epoch: stale });
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  native.stall("js", 2000, { epoch: stale });
  assert.equal(freezes.takeFreezeCounts().js_stall_2_5s, 0, "a stall from an earlier sharing period isn't sent in a later one");
});

test("a page that stops responding is counted when it recovers or is exited, by how long it hung", () => {
  client.setSharing(true, "settings");
  freezes.takeFreezeCounts();
  const hangs = [
    ["a", 1_000, false],
    ["b", 12_000, false],
    ["c", 45_000, true],
    ["d", 600_000, true],
  ];
  for (const [tab, ms, exited] of hangs) {
    freezes.noteRendererUnresponsive(tab, 1000);
    freezes.noteRendererUnresponsive(tab, 2000);
    freezes.noteRendererResponsive(tab, exited, 1000 + ms);
  }
  freezes.noteRendererResponsive("never-hung", false, 5000);
  const sent = freezes.takeFreezeCounts();
  assert.deepEqual(
    Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith("renderer_"))),
    {
      renderer_unresponsive: 4,
      renderer_unresponsive_exited: 2,
      renderer_unresponsive_under_5s: 1,
      renderer_unresponsive_5_30s: 1,
      renderer_unresponsive_30s_2m: 1,
      renderer_unresponsive_over_2m: 1,
    },
  );
});

test("the fields are counts, timings and floors only", () => {
  client.setSharing(true, "settings");
  native.stall("main", 900, { inputWaitMs: 600 });
  for (const [key, value] of Object.entries(freezes.takeFreezeCounts())) {
    assert.match(key, /^[a-z0-9_]+$/);
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${key} is a whole number`);
  }
});
