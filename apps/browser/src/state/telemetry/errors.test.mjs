import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const { setSharing } = await import("./client.ts");
const { captureException, reportNativeCrashes } = await import("./errors.ts");

globalThis.fetch = async () => ({ status: 200 });
setSharing(true, "settings");
after(() => setSharing(false, "settings"));

const queued = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? "{}").events?.filter((e) => e.event === "$exception") ?? [];

test("a JS error is on disk the moment it's captured, so a crash right after can't lose it", () => {
  const before = queued().length;
  captureException(new TypeError("Attempting to run JS driven animation on a native node"), "react");
  const events = queued();
  assert.equal(events.length, before + 1);
  const props = events.at(-1).properties;
  assert.deepEqual(props.$exception_types, ["TypeError"]);
  assert.deepEqual(props.$exception_values, ["Attempting to run JS driven animation on a native node"]);
  assert.equal(props.$exception_list[0].value, "Attempting to run JS driven animation on a native node");
});

test("a native crash names its exception and the app's images at the top level, never its reason", async () => {
  stub.shellNativeModules.ArdiaApp.crashReports = async () => [
    {
      time: Date.now(),
      process: "browser",
      appVersion: "0.3.0",
      exceptionType: "EXC_CRASH",
      signal: "SIGABRT",
      exceptionName: "RCTFatalException",
      exceptionReason: "Unhandled JS Exception: moved to \"native\" earlier, js engine: hermes, stack:\nGroupBlock@1:2",
      frames: [{ image: "Chromium Framework", symbol: "ArdiaCoreMain", symbolOffset: 66417332, offset: 0x41a36e8 }],
      exceptionFrames: [{ image: "Ardia", offset: 0x38eab8 }],
      images: [{ name: "Ardia", uuid: "1c77ef99-77d4-3de8-9ba2-6929e276bc60" }],
    },
  ];
  await reportNativeCrashes();
  const props = queued().at(-1).properties;
  assert.equal(props.source, "native_crash");
  assert.equal(props.objc_exception, "RCTFatalException");
  assert.deepEqual(props.$exception_types, ["RCTFatalException", "EXC_CRASH"]);
  assert.deepEqual(props.$exception_values, ["Uncaught RCTFatalException", "EXC_CRASH (SIGABRT)"]);
  assert.equal(JSON.stringify(queued().at(-1)).includes("GroupBlock"), false);
  assert.deepEqual(props.crash_images, [{ name: "Ardia", uuid: "1c77ef99-77d4-3de8-9ba2-6929e276bc60" }]);
  assert.equal(props.$exception_list[0].stacktrace.frames[0].function, "Ardia + 0x38eab8");
  assert.equal(props.$exception_list[1].stacktrace.frames[0].function, "Chromium Framework + 0x41a36e8");
  assert.equal(props.$geoip_disable, true);
});

test("a native crash carries the built-in page its session was on as ctx_webui_page, null for a web page or an older sample", async () => {
  const later = Date.now() + 60 * 60_000;
  let n = 0;
  for (const [webui_page, expected] of [["settings/cookies", "settings/cookies"], [null, null], [undefined, null]]) {
    const time = later + 10_000 * ++n;
    const saved = { at: time - 500, session_start: time - 5000, tabs: 4, ...(webui_page === undefined ? {} : { webui_page }) };
    stub.shellNativeModules.ArdiaApp.crashReports = async () => [
      { time, fileTime: time, process: "browser", exceptionType: "EXC_BREAKPOINT", signal: "SIGTRAP", frames: [{ image: "Chromium Framework", offset: 0x41a36e8 }] },
    ];
    await reportNativeCrashes([saved]);
    const props = queued().at(-1).properties;
    assert.equal(props.crash_process, "browser");
    assert.equal(props.ctx_tabs, 4);
    assert.equal(props.ctx_webui_page, expected, String(webui_page));
  }
});

test("a browser crash carries the JS engine's or React Native's fatal reason as crash_js_reason, scrubbed and length-limited, and no other crash does", async () => {
  const time = Date.now() + 3 * 60 * 60_000;
  const long = `Hades OOM: ${"heap ".repeat(80)}`;
  const hermes = (process, jsFatal, at) => ({ time: at, fileTime: at, process, exceptionType: "EXC_CRASH", signal: "SIGABRT", jsFatal, frames: [{ image: "hermes", offset: 0x19bea4 }] });
  const reactNative = (process, jsFatal, at) => ({ time: at, fileTime: at, process, exceptionType: "EXC_BREAKPOINT", signal: "SIGTRAP", exceptionName: "RCTFatalException", jsFatal, frames: [{ image: "Ardia", offset: 0x444da4 }] });
  const cases = [
    [hermes, "browser", "Out of memory allocating the young generation", "Out of memory allocating the young generation"],
    [hermes, "browser", "OOM at https://example.com/private?q=secret on /Users/someone/Library/page.json for me@example.com", null],
    [hermes, "browser", long, null],
    [hermes, "browser", "", null],
    [hermes, "browser", undefined, null],
    [hermes, "browser", 42, null],
    [hermes, "renderer", "Out of memory allocating the young generation", null],
    [reactNative, "browser", "Exception in HostFunction: Unknown native module", "Exception in HostFunction: Unknown native module"],
    [reactNative, "browser", "Unhandled JS Exception: TypeError: cannot read https://example.com/private?q=secret", null],
  ];
  let n = 0;
  for (const [make, process, jsFatal, expected] of cases) {
    const at = time + 10_000 * ++n;
    const report = make(process, jsFatal, at);
    stub.shellNativeModules.ArdiaApp.crashReports = async () => [report];
    await reportNativeCrashes();
    const sent = queued().at(-1);
    const props = sent.properties;
    assert.equal(props.crash_process, process);
    if (report.exceptionName) assert.equal(props.objc_exception, report.exceptionName);
    const reason = props.crash_js_reason;
    if (expected !== null) assert.equal(reason, expected);
    else if (typeof jsFatal === "string" && jsFatal && process === "browser") {
      assert.equal(typeof reason, "string");
      assert.ok(reason.length <= 160, `${reason.length} characters`);
      for (const leak of ["example.com", "secret", "/Users", "someone", "page.json"]) assert.equal(JSON.stringify(sent).includes(leak), false, leak);
    } else assert.equal(reason, null, `${process} ${String(jsFatal)}`);
  }
});
