import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { QUIT_WARNING, askBeforeQuitting, asksBeforeQuit, quitWarningMayAsk, windowsStayingOpen } = await import("./quitWarning.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");

const asking = { quitsWithLastWindow: true, background: false, warns: true, staysOpen: [] };
const closing = new Set();
const staying = (ids, browsers = ["w1", "w2"]) => windowsStayingOpen(ids, "w1", new Set(browsers), (id) => closing.has(id));

test("a close quits only when no other window stays open", () => {
  assert.deepEqual(staying(["w1"]), []);
  assert.deepEqual(staying(["w1", "w2"]), ["w2"]);
  assert.deepEqual(staying(["w1", "settings"]), ["settings"], "an open Settings window keeps the app running");
  assert.deepEqual(staying(["w1", "import"]), ["import"]);
  assert.deepEqual(staying([]), ["w1"], "an empty list means the native side didn't answer, so it doesn't ask");
});

test("a window already closing, or gone from the UI while its native window fades, doesn't keep the app open", () => {
  closing.add("w2");
  assert.deepEqual(staying(["w1", "w2"]), [], "w2 is in its close animation");
  closing.clear();
  assert.deepEqual(staying(["w1", "w2"], ["w1"]), [], "w2 left the UI's windows but native still lists it until it's destroyed");
});

test("the warning asks only on Windows, with the setting on, and never on a hidden test instance", () => {
  assert.equal(asksBeforeQuit(asking), true);
  assert.equal(asksBeforeQuit({ ...asking, warns: false }), false);
  assert.equal(asksBeforeQuit({ ...asking, background: true }), false);
  assert.equal(asksBeforeQuit({ ...asking, quitsWithLastWindow: false }), false, "the Mac keeps running with no windows");
  assert.equal(asksBeforeQuit({ ...asking, staysOpen: ["w2"] }), false);
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
  assert.equal(quitWarningMayAsk(), false);
  assert.equal(await askBeforeQuitting(id), "notAsked");
  const { closeLittleArdia } = await import("../littleArdia/actions.ts");
  const { isWindowClosing } = await import("./closingWindows.ts");
  const small = useBrowser.getState().createWindow({ url: "https://b.com", kind: "small" });
  closeLittleArdia(small);
  assert.equal(isWindowClosing(small) || !useBrowser.getState().windows[small], true, "Little Ardia still starts closing at once");
  assert.equal(asked, 0);
});

test("only Windows quits when its last window closes", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../../lib/platformFeatures.windows.ts"), /quitsWithLastWindow: true\b/);
  assert.match(source("../../lib/platformFeatures.ts"), /quitsWithLastWindow: false\b/);
});

test("closing a window's last tab asks the quit question unless the last-tab confirm just asked", () => {
  const actions = readFileSync(new URL("../browser/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /if \(last && !asksTabs && quitWarningMayAsk\(\) && \(await askBeforeQuitting\(w\.id\)\) === "cancelled"\) return;\n  const now = store\(\);/);
});
