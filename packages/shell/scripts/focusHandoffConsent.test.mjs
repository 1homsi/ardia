import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every focus hand-off outcome is counted only if sharing hasn't changed since the hand-off began", () => {
  const source = read("../ios/FocusHandoff.swift");
  const calls = source.match(/outcomes\.(?:add|delivered)\(.*\)$/gm) ?? [];
  assert.ok(calls.length >= 5, `found ${calls.length} outcome calls`);
  for (const call of calls) assert.match(call, /since: /, call);
  assert.match(read("../ios/FocusModule.swift"), /Function\("setConsentEpoch"\)/);
});
