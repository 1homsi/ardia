import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install-1", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { recordLog } = await import("./logs.ts");
client.startClient();
after(() => {
  client.setSharing(false, "settings");
  local.flushLocal();
});

const queued = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[],"logs":[]}');
const attributesOf = (log) => Object.fromEntries(log.attributes.map((a) => [a.key, a.value.stringValue]));

test("an Error after the label queues its type and code, and its message only when it is one of Ardia's own", () => {
  const error = Object.assign(new Error("release of tab 1234567 failed for https://example.com/a at /Users/me/host.ts"), { code: "ERR_ENGINE" });
  recordLog("error", ["[ardia host] release failed", error]);
  client.saveQueueNow();
  const log = queued().logs.at(-1);
  const attributes = attributesOf(log);
  assert.equal(attributes.error_type, "Error");
  assert.ok(!("error_message" in attributes));
  assert.equal(attributes.error_code, "ERR_ENGINE");
  assert.doesNotMatch(JSON.stringify(log), /example\.com|1234567|\/Users\/me|release of tab/);
  local.flushLocal();
  const record = stub.telemetryLocal.records().findLast((r) => r.kind === "log");
  assert.equal(record.message, "[ardia host] release failed");
  assert.ok(!("error_message" in record.attributes));
  assert.equal(record.attributes.error_code, "ERR_ENGINE");
});

test("an Error with no message or no usable code adds only what it has", () => {
  recordLog("error", ["[ardia host]", Object.assign(new TypeError(""), { code: "not a code!" })]);
  client.saveQueueNow();
  const attributes = attributesOf(queued().logs.at(-1));
  assert.equal(attributes.error_type, "TypeError");
  assert.ok(!("error_message" in attributes));
  assert.ok(!("error_code" in attributes));
});

test("a log line with no Error keeps error_type none and gets no message or code", () => {
  recordLog("warn", ["a plain warning", { code: "X" }, "detail"]);
  client.saveQueueNow();
  const attributes = attributesOf(queued().logs.at(-1));
  assert.equal(attributes.error_type, "none");
  assert.ok(!("error_message" in attributes));
  assert.ok(!("error_code" in attributes));
});

test("one label with two different reasons is queued twice, the same reason only once", () => {
  const before = queued().logs.length;
  recordLog("error", ["[ardia host] release failed", new Error("Window close cancelled")]);
  recordLog("error", ["[ardia host] release failed", new Error("Window close cancelled")]);
  client.saveQueueNow();
  assert.equal(queued().logs.length, before + 1);
  recordLog("error", ["[ardia host] release failed", new Error("Window close is no longer current")]);
  client.saveQueueNow();
  const logs = queued().logs;
  assert.equal(logs.length, before + 2);
  assert.equal(attributesOf(logs.at(-2)).error_message, "Window close cancelled");
  assert.equal(attributesOf(logs.at(-1)).error_message, "Window close is no longer current");
});

const sentFor = (label, error) => {
  recordLog("error", [label, error]);
  client.saveQueueNow();
  const log = queued().logs.at(-1);
  assert.equal(log.body.stringValue, label);
  return attributesOf(log);
};

for (const [name, message] of [
  ["a token in the message", "Authorization failed for Bearer qwertySecretToken"],
  ["an extension's own error", "Extension 'abc' threw: something"],
  ["a page's error text", "Uncaught TypeError: foo is not a function at https://site.example/app.js:1:2"],
  ["a file path", "Could not open /Users/someone/secret.txt"],
]) {
  test(`an error message that isn't one of Ardia's own is left out: ${name}`, () => {
    const attributes = sentFor(`[free text] ${name}`, new Error(message));
    assert.equal(attributes.error_type, "Error");
    assert.ok(!("error_message" in attributes), JSON.stringify(attributes));
  });
}

test("an error code Ardia doesn't define is left out", () => {
  const attributes = sentFor("[free text] unknown code", Object.assign(new Error("x"), { code: "SOME_RANDOM_CODE" }));
  assert.ok(!("error_code" in attributes), JSON.stringify(attributes));
});

test("the native call template and Ardia's own message and code are sent", async () => {
  const { ArdiaError } = await import("@ardia/core");
  const native = sentFor("[known] native call", Object.assign(new Error("Calling the 'query' function has failed"), { code: "ERR_ENGINE" }));
  assert.equal(native.error_message, "Calling the 'query' function has failed");
  assert.equal(native.error_code, "ERR_ENGINE");
  const own = sentFor("[known] own error", new ArdiaError("ERR_BAD_REPLY", "the reply isn't JSON"));
  assert.equal(own.error_type, "ArdiaError");
  assert.equal(own.error_message, "the reply isn't JSON");
  assert.equal(own.error_code, "ERR_BAD_REPLY");
});

test("the distinct log lines are still capped at 40", () => {
  for (let i = 0; i < 60; i++) recordLog("error", [`distinct label ${"abcdefghij"[i % 10]}${"klmnopqrst"[Math.floor(i / 10)]}`, new Error("x")]);
  client.saveQueueNow();
  assert.equal(queued().logs.length, 40);
});
