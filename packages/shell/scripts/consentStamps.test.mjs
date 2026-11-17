import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const IOS = new URL("../ios/", import.meta.url);
const read = (name) => readFileSync(new URL(name, IOS), "utf8");
const COUNTED = ["centeredResize", "windowTitleRead", "windowDragLoop"];

test("every app event JS telemetry counts is sent through a consent stamp", () => {
  for (const name of readdirSync(IOS).filter((n) => n.endsWith(".swift"))) {
    for (const line of read(name).split("\n")) {
      const event = COUNTED.find((e) => line.includes(`"type": "${e}"`) && line.includes("ShellEvents.send"));
      if (event) assert.match(line, /\.onto\(\["type": /, `${name}: ${event} is sent without a consent stamp: ${line.trim()}`);
    }
  }
});

test("an Option resize is stamped when its live resize starts, and the count sends that stamp", () => {
  const resize = read("CenteredResize.swift");
  assert.match(resize, /willStartLiveResizeNotification[^}]*CenteredResize\.stamp = ArdiaConsentStamp\.begin\(\)/s);
  assert.match(resize, /ShellEvents\.send\(\.app, \(stamp \?\? ArdiaConsentStamp\.begin\(\)\)\.onto\(\["type": "centeredResize"\]\)\)/);
});

test("a window drag loop is stamped as it begins, before the loop runs", () => {
  const move = read("WindowMove.swift");
  const begin = move.indexOf('ShellEvents.send(.app, ArdiaConsentStamp.begin().onto(["type": "windowDragLoop"]))');
  assert.ok(begin > 0 && begin < move.indexOf("let start = screenPoint(event)"), "the drag loop is reported with the epoch from its start");
});
