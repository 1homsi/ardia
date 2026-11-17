import assert from "node:assert/strict";
import test from "node:test";

test("Settings › General › Crash reports opens the details with View My Data once the shell has storage for the local copy", async () => {
  globalThis.indexedDB = { open() { throw new Error("unused"); } };
  globalThis.document = {};
  const index = await import("./settingsIndex.ts");
  assert.equal(index.settingUnavailable("general.crashDetails"), false);
  assert.equal(index.sectionUnavailable("general", "Crash reports"), false);
  const details = index.SETTINGS_INDEX.find((item) => item.entry.id === "general.crashDetails");
  assert.ok(details);
  assert.ok(details.entry.keywords.includes("view my data"));
});

test("Settings › General › Crash reports offers the sharing toggle, as on the Mac", async () => {
  const index = await import("./settingsIndex.ts");
  assert.equal(index.settingUnavailable("general.shareDiagnostics"), false);
  assert.equal(index.sectionUnavailable("general", "Crash reports"), false);
  assert.ok(index.SETTINGS_INDEX.some((item) => item.entry.id === "general.shareDiagnostics"));
});
