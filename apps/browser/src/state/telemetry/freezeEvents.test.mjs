import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const { NativeModules } = await import("react-native");
const annotations = [];
const native = {
  epoch: 0,
  start: () => true,
  setConsentEpoch(epoch) {
    this.epoch = epoch;
    return true;
  },
  take: () => null,
  annotate: (id, activity) => (annotations.push([id, activity]), true),
};
NativeModules.ACFreezeWatch = native;

const client = await import("./client.ts");
const freezes = await import("./freezes.ts");
const events = await import("./freezeEvents.ts");
const records = await import("./freezeRecords.ts");
const jobs = await import("../app/jobActivity.ts");
after(() => client.setSharing(false, "settings"));

const frames = (...pairs) => pairs.map(([image, offset]) => ({ image, offset }));
let nextId = 100;
const record = (over = {}) => ({
  id: nextId++,
  thread: "js",
  startedAt: Date.now() - 3000,
  durationMs: 2400,
  inputWaitMs: 900,
  gcMs: 2100,
  gcCount: 7,
  thermal: 2,
  epoch: native.epoch,
  samples: [{ state: 1, frames: frames(["hermes", 0x1ae2a0], ["hermes", 0x1ae528], ["Ardia", 0x4400], ["system", 0x123]) }],
  images: [
    { name: "hermes", uuid: "11111111-2222-3333-4444-555555555555" },
    { name: "/Users/someone/evil.dylib", uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  ],
  ...over,
});

async function sentFreezes() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events.filter((e) => e.event === "app_freeze").map((e) => e.properties);
}

beforeEach(() => {
  client.loadChoice();
  client.setSharing(false, "settings");
  events.resetFreezeEventsForTests();
  jobs.forgetActivitiesForTests();
  stub.docs.delete("freezes.txt");
  stub.docs.delete("telemetry-queue.json");
  annotations.length = 0;
});

test("the frame scrubber keeps our own images and 'system' with offsets and turns anything else into 'other' with no offset", () => {
  assert.deepEqual(
    events.scrubFrames(frames(["Chromium Framework", 10], ["system", 20], ["/usr/lib/libfoo.dylib", 30], ["Evil Helper", 40], ["other", 50], ["hermes", -1])),
    frames(["Chromium Framework", 10], ["system", 20], ["other", 0], ["other", 0], ["other", 0], ["hermes", 0]),
  );
  assert.equal(events.scrubFrames(Array.from({ length: 40 }, (_, i) => ({ image: "Ardia", offset: i }))).length, 24);
});

test("a signature is the top three frames from our own images: same place, same signature; elsewhere, different", () => {
  const a = events.freezeSignature("js", frames(["system", 1], ["hermes", 0x10], ["hermes", 0x20], ["Ardia", 0x30], ["Ardia", 0x40]));
  const b = events.freezeSignature("js", frames(["system", 9], ["hermes", 0x10], ["hermes", 0x20], ["Ardia", 0x30], ["Ardia", 0x99]));
  const c = events.freezeSignature("js", frames(["hermes", 0x11], ["hermes", 0x20], ["Ardia", 0x30]));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(events.freezeSignature("main", frames(["system", 1])), "none_main");
  assert.notEqual(events.freezeSignature("main", frames(["Ardia", 1])), events.freezeSignature("js", frames(["Ardia", 1])));
});

test("sharing off: nothing is sent, but the local record still gets the job that was running", async () => {
  freezes.startFreezeWatch();
  const end = jobs.beginActivity("sync", Date.now() - 2900);
  end();
  await events.reportFreeze(record({ epoch: 0 }));
  assert.deepEqual(await sentFreezes(), []);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0][1], "sync");
});

test("a freeze from an earlier sharing period isn't sent in a later one", async () => {
  client.setSharing(true, "settings");
  const stale = native.epoch;
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  await events.reportFreeze(record({ epoch: stale }));
  assert.deepEqual(await sentFreezes(), []);
});

test("app_freeze carries buckets, counts, enums, the signature and scrubbed frames and images only", async () => {
  client.setSharing(true, "settings");
  const done = jobs.beginActivity("sessionSave", Date.now() - 3100);
  await events.reportFreeze(record());
  done();
  const [sent] = await sentFreezes();
  assert.ok(sent);
  assert.equal(sent.freeze_thread, "js");
  assert.equal(sent.freeze_duration, "2_5s");
  assert.equal(sent.freeze_ms, 2400);
  assert.equal(sent.input_wait_ms, 900);
  assert.equal(sent.gc_ms, 2100);
  assert.equal(sent.gc_count, 7);
  assert.equal(sent.activity, "sessionSave");
  assert.equal(sent.thermal, "serious");
  assert.match(sent.signature, /^[0-9a-f]{8}$/);
  assert.ok(["sidebar", "top"].includes(sent.layout));
  assert.equal(typeof sent.sync_on, "boolean");
  const text = JSON.stringify(sent);
  assert.ok(!text.includes("/Users/"), "no paths");
  assert.ok(!text.includes("evil"), "only allowlisted images");
  assert.ok(!/interpretFunction|HadesGC/.test(text), "no symbol names");
  assert.deepEqual(sent.freeze_images, [{ name: "hermes", uuid: "11111111-2222-3333-4444-555555555555" }]);
  assert.ok(sent.freeze_frames.every((f) => f.lang === "native" && /^(hermes|Ardia|system) \+ 0x[0-9a-f]+$/.test(f.function)));
});

test("at most 5 a session, and one of each signature", async () => {
  client.setSharing(true, "settings");
  await events.reportFreeze(record());
  await events.reportFreeze(record());
  assert.equal((await sentFreezes()).length, 1, "same signature twice: sent once");
  for (let i = 1; i <= 6; i++) await events.reportFreeze(record({ samples: [{ state: 1, frames: frames(["Ardia", 0x1000 * i]) }] }));
  assert.equal((await sentFreezes()).length, events.MAX_FREEZES_PER_SESSION);
});

test("at most 20 a day and one of each signature a day, counted from the local record", () => {
  const now = Date.now();
  const today = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, startedMs: now - 1000 * i, signature: `s${i}` }));
  assert.equal(events.allowedToSend("new", { id: 99, startedAt: now, thread: "js" }, today), false, "20 already today");
  assert.equal(events.allowedToSend("s3", { id: 99, startedAt: now, thread: "js" }, today.slice(0, 5)), false, "seen today");
  assert.equal(events.allowedToSend("new", { id: 99, startedAt: now, thread: "js" }, today.slice(0, 5)), true);
  const yesterday = today.map((r) => ({ ...r, startedMs: now - 86_400_000 * 2 }));
  assert.equal(events.allowedToSend("s3", { id: 99, startedAt: now, thread: "js" }, yesterday), true, "other days don't count");
});

const slot = (text) => (text + " ".repeat(4096)).slice(0, 4095) + "\n";

test("the local record parses back, and Copy Diagnostics and Copy Last Freeze describe it", () => {
  const now = Date.now();
  const file =
    slot(`freeze 7 main recovered\nstarted_ms ${now - 60_000}\nduration_ms 6043\ninput_wait_ms 0\ngc_ms unknown\nactivity none\nthermal 0\nsample 1 state 1\n  system +0x1a\n  Chromium Framework +0x2b3c\n  Ardia +0x44\nimage Chromium Framework 11111111-2222-3333-4444-555555555555\nend\n`) +
    slot(`freeze 8 js frozen\nstarted_ms ${now - 5_000}\nduration_ms 2000\ninput_wait_ms 0\ngc_ms 1900\nactivity sync\nthermal 1\nsample 1 state 1\n  hermes +0x1ae2a0\nend\n`) +
    slot("garbage slot");
  const parsed = records.parseFreezeRecords(file);
  assert.deepEqual(parsed.map((r) => [r.seq, r.thread, r.recovered, r.durationMs, r.activity]), [
    [7, "main", true, 6043, "none"],
    [8, "js", false, 2000, "sync"],
  ]);
  assert.equal(records.topOwnFrame(parsed[0]), "Chromium Framework +0x2b3c");
  assert.equal(records.freezeSummaryLine(parsed, now), "Freezes: 2 today, longest 6.0 s; last 2.0 s on the js thread (did not recover), cause sync");
  assert.ok(records.lastFreezeText(parsed).includes("freeze 8 js frozen"));
  assert.equal(records.freezeSummaryLine([], now), "Freezes: none recorded");
  assert.deepEqual(records.parseFreezeRecords("freeze 1 main recovered\nno end marker"), []);
});

test("the job a freeze overlapped most is its activity", () => {
  const now = Date.now();
  jobs.beginActivity("sync", now - 10)();
  const save = jobs.beginActivity("sessionSave", now - 9000);
  assert.equal(jobs.activityDuring(now - 9000, now + 1000), "sessionSave");
  save();
  assert.equal(jobs.activityDuring(now - 60_000, now - 50_000), "none");
  assert.equal(jobs.during("import", () => 41) + 1, 42);
});
