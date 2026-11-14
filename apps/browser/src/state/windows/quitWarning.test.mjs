import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { QUIT_WARNING, askBeforeQuitting, asksBeforeQuit, closingQuits } = await import("./quitWarning.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");

const windows = { quitsWithLastWindow: true, background: false, warns: true, closing: "w1" };

test("closing quits only where the last window's close quits, and only when no other window stays open", () => {
  assert.equal(closingQuits({ ...windows, openWindowIds: ["w1"] }), true);
  assert.equal(closingQuits({ ...windows, openWindowIds: ["w1", "settings"] }), false, "an open Settings window keeps the app running");
  assert.equal(closingQuits({ ...windows, openWindowIds: ["w1", "w2"] }), false);
  assert.equal(closingQuits({ ...windows, openWindowIds: [] }), false, "an empty list means the native side didn't answer");
  assert.equal(closingQuits({ ...windows, quitsWithLastWindow: false, openWindowIds: ["w1"] }), false, "the Mac keeps running with no windows");
});

test("the warning asks only with the setting on and never on a hidden test instance", () => {
  assert.equal(asksBeforeQuit({ ...windows, openWindowIds: ["w1"] }), true);
  assert.equal(asksBeforeQuit({ ...windows, warns: false, openWindowIds: ["w1"] }), false);
  assert.equal(asksBeforeQuit({ ...windows, background: true, openWindowIds: ["w1"] }), false);
});

test("the warning uses the Mac's words and its don't-ask-again", () => {
  const mac = readFileSync(new URL("../../../../../packages/shell/ios/QuitFlow.swift", import.meta.url), "utf8");
  assert.match(mac, /Are you sure you want to quit \\\(ProcessInfo\.processInfo\.processName\)\?/);
  assert.equal(QUIT_WARNING.title, "Are you sure you want to quit Ardia?");
  assert.ok(mac.includes(`"${QUIT_WARNING.message}"`));
  assert.ok(mac.includes(`addButton(withTitle: "${QUIT_WARNING.confirmTitle}")`));
  assert.ok(mac.includes(`"${QUIT_WARNING.suppression.replace("’", "'")}"`));
});

test("on the Mac closing a window never shows the quit warning", async () => {
  let asked = 0;
  shellNativeModules.ArdiaDialogs.confirm = () => {
    asked += 1;
    return Promise.resolve({ confirmed: false, suppressed: false });
  };
  useBrowser.getState().hydrate({});
  useBrowser.getState().updateSettings({ warnBeforeQuitting: true });
  const id = useBrowser.getState().createWindow({ url: "https://a.com" });
  assert.equal(await askBeforeQuitting(id), "notAsked");
  assert.equal(asked, 0);
});

test("only Windows quits when its last window closes", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../../lib/platformFeatures.windows.ts"), /quitsWithLastWindow: true\b/);
  assert.match(source("../../lib/platformFeatures.ts"), /quitsWithLastWindow: false\b/);
});
