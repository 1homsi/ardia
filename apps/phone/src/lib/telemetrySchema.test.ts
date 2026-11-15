import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersionOf, launchProps, legacyImportOutcome, osVersionOf, parseDaily, pendingUsage, rollOver } from "./telemetrySchema.ts";

test("launch timings are measured from the process start, and dropped when it is unknown or out of range", () => {
  assert.deepEqual(launchProps(1000, 1300, 1900), { launch_ms: 900, js_ms: 300 });
  assert.equal(launchProps(null, 1300, 1900), null);
  assert.equal(launchProps(2000, 1300, 1900), null);
  assert.equal(launchProps(0, 1, 700_001), null);
});

test("the old app's import reads as imported, started fresh or none from how the launch got past it", () => {
  assert.equal(legacyImportOutcome("imported"), "imported");
  assert.equal(legacyImportOutcome("startedFresh"), "started_fresh");
  assert.equal(legacyImportOutcome("none"), "none");
  assert.equal(legacyImportOutcome(null), "none");
});

test("versions keep only their numbers", () => {
  assert.equal(osVersionOf(35), "35");
  assert.equal(osVersionOf("18.1.1"), "18.1.1");
  assert.equal(osVersionOf("15 (Ada's build)"), "15");
  assert.equal(appVersionOf("1.0.0"), "1.0.0");
  assert.equal(appVersionOf("Ardia nightly"), "0");
});

test("a damaged day of counts starts over rather than sending something odd", () => {
  assert.equal(parseDaily("{"), null);
  assert.equal(parseDaily(JSON.stringify({ day: "yesterday", tabs_opened: 3 })), null);
  assert.deepEqual(parseDaily(JSON.stringify({ day: "2026-11-13", tabs_opened: -2, searches: 1.5, pins_to_mac: 2 })), { day: "2026-11-13", tabs_opened: 0, searches: 0, pins_to_mac: 2, tabs_sent: 0, page_processes_gone: 0, links_given_up: 0, pages_reloaded_online: 0, spaces_swiped: 0, tray_hidden_rows_opened: 0, deck_pictures_late: 0, tray_back_swiped: 0, search_tabs_opened: 0 });
  assert.deepEqual(rollOver(null, "2026-11-14").due, null);
});

test("counts kept by native while JavaScript wasn't running come back as one count per send, only for known fields and whole positive numbers", () => {
  assert.deepEqual(pendingUsage({ tabs_sent: 2 }), ["tabs_sent", "tabs_sent"]);
  assert.deepEqual(pendingUsage({ tabs_sent: 1, tabs_opened: 1 }), ["tabs_opened", "tabs_sent"]);
  assert.deepEqual(pendingUsage({ made_up: 3, tabs_sent: -1, searches: 1.5, pins_to_mac: "2" }), []);
  assert.equal(pendingUsage({ tabs_sent: 1e9 }).length, 1000);
});
