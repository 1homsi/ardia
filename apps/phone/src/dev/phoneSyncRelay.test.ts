import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySide, nextRecord, parseListing, plan } from "../../scripts/phone-sync-relay.mjs";

type Entry = { mtime: number; size: number };
type Side = Record<string, Entry>;

const at = (mtime: number, size = 10): Entry => ({ mtime, size });

function simulate(record: Record<string, { mac?: Entry; phone?: Entry }>, mac: Side, phone: Side, copiedAt: number) {
  const steps = plan(mac, phone, record);
  const afterMac = { ...mac };
  const afterPhone = { ...phone };
  for (const { kind, file } of steps) {
    if (kind === "toPhone") afterPhone[file] = at(copiedAt, mac[file]!.size);
    else if (kind === "toMac") afterMac[file] = at(copiedAt, phone[file]!.size);
    else if (kind === "deleteOnMac") delete afterMac[file];
    else delete afterPhone[file];
  }
  const after = { mac: afterMac, phone: afterPhone };
  return { steps, after, record: nextRecord(record, { mac, phone }, after, steps, steps) };
}

test("new files go across, and a second pass with nothing changed does nothing", () => {
  const first = simulate({}, { "a.json": at(100) }, { "b.json": at(200) }, 300);
  assert.deepEqual(first.steps, [
    { kind: "toPhone", file: "a.json" },
    { kind: "toMac", file: "b.json" },
  ]);
  const second = simulate(first.record, first.after.mac, first.after.phone, 400);
  assert.deepEqual(second.steps, []);
});

test("a change on one side is copied to the other even though the copy is newer than the change", () => {
  const synced = simulate({}, { "a.json": at(100) }, {}, 300);
  const changed = simulate(synced.record, { "a.json": at(150, 12) }, synced.after.phone, 500);
  assert.deepEqual(changed.steps, [{ kind: "toPhone", file: "a.json" }]);
  const phoneChanged = simulate(changed.record, changed.after.mac, { "a.json": at(600, 14) }, 700);
  assert.deepEqual(phoneChanged.steps, [{ kind: "toMac", file: "a.json" }]);
});

test("a file deleted on one side after both had it is deleted on the other; one that never synced is copied", () => {
  const synced = simulate({}, { "a.json": at(100), "b.json": at(100) }, {}, 300);
  const deleted = simulate(synced.record, synced.after.mac, { "b.json": synced.after.phone["b.json"]! }, 400);
  assert.deepEqual(deleted.steps, [{ kind: "deleteOnMac", file: "a.json" }]);
  assert.deepEqual(Object.keys(deleted.record), ["b.json"]);
});

test("changed on both sides, the newer one wins", () => {
  const synced = simulate({}, { "a.json": at(100) }, {}, 300);
  const both = plan({ "a.json": at(800, 20) }, { "a.json": at(900, 30) }, synced.record);
  assert.deepEqual(both, [{ kind: "toMac", file: "a.json" }]);
});

test("a source that changed while it was copied is copied again on the next pass, never copied back", () => {
  const before = { mac: { "a.json": at(100) }, phone: {} };
  const steps = plan(before.mac, before.phone, {});
  const after = { mac: { "a.json": at(150, 11) }, phone: { "a.json": at(300) } };
  const record = nextRecord({}, before, after, steps, steps);
  assert.deepEqual(plan(after.mac, after.phone, record), [{ kind: "toPhone", file: "a.json" }]);
});

test("a step that failed keeps its old record, so the next pass tries it again", () => {
  const before = { mac: { "a.json": at(100) }, phone: {} };
  const steps = plan(before.mac, before.phone, {});
  const record = nextRecord({}, before, before, steps, []);
  assert.deepEqual(record, {});
  assert.deepEqual(plan(before.mac, before.phone, record), [{ kind: "toPhone", file: "a.json" }]);
});

test("listings from BSD and GNU stat parse, with spaces in names and the relay's own partial files left out", () => {
  const files = parseListing("1700000000 42 ./scope/one file.json\n1700000001 7 ./b.json\n1700000002 9 ./b.json.relay-part\nnoise\n");
  assert.deepEqual(files, { "scope/one file.json": { mtime: 1700000000, size: 42 }, "b.json": { mtime: 1700000001, size: 7 } });
});

test("a side that lists nothing after a pass saw files there stops the pass instead of deleting the other side", () => {
  const synced = simulate({}, { "a.json": at(100) }, {}, 300);
  assert.equal(emptySide({ mac: synced.after.mac, phone: {} }, synced.record), "phone");
  assert.equal(emptySide({ mac: {}, phone: synced.after.phone }, synced.record), "mac");
  assert.equal(emptySide({ mac: synced.after.mac, phone: synced.after.phone }, synced.record), null);
  assert.equal(emptySide({ mac: {}, phone: {} }, {}), null);
});

test("the relay's probe file is left out of a pass's listing and kept for the probe itself", () => {
  const out = "1700000000 18 ./.ardia-relay-probe\n1700000001 7 ./b.json\n";
  assert.deepEqual(Object.keys(parseListing(out)), ["b.json"]);
  assert.deepEqual(parseListing(out, { withProbe: true })[".ardia-relay-probe"], { mtime: 1700000000, size: 18 });
});
