import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DeviceEventEmitter, turboModules } from "../test-native/reactNative.ts";

const calls = [];
const opening = new Map();
turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    const args = JSON.parse(argsJson);
    calls.push({ verb, args, windowId });
    if (verb === "tab.create" && opening.has(args.key)) await opening.get(args.key).promise;
    return JSON.stringify(verb === "tab.create" ? { tab: calls.length } : { ok: true });
  },
  engineCall: async () => "{}",
};

const { mountPage, showPage, followPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { takeKeptFollows } = await import("../../../../packages/expo-windows/src/engine/keptFollow.ts");
const { noteFieldAsked, readFocusedFieldWith } = await import("../../../../packages/expo-windows/src/appKeyboard.ts");

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const shape = { x: 0, y: 0, width: 200, height: 100, radius: 0, holes: [] };
const followed = (key) => calls.filter((call) => call.verb === "tab.call" && call.args.key === key && call.args.method === "focus").map((call) => call.args);
const FOLLOWED = [{ follow: true, key: "", method: "focus", deferred: true }];
const followedOnce = (key) => [{ ...FOLLOWED[0], key }];
const emitTopic = (topic, payload) => DeviceEventEmitter.emit("ArdiaEngineHost:event", { topic, json: JSON.stringify(payload) });
let focused = null;
readFocusedFieldWith(() => focused);
const mounted = [];
const mount = (key, windowId = "w") => mounted.push(mountPage(key, { url: `https://${key}.example/`, windowId }, () => {}));
const unmountAll = async () => {
  for (const unmount of mounted.splice(0)) unmount();
  focused = null;
  await settle();
  takeKeptFollows();
};
const realNow = Date.now;
let later = 0;
Date.now = () => realNow() + later;
const slowOpen = (key) => {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  opening.set(key, { promise });
  return () => release();
};

test("the issue's case: a follow asked before its tab's page exists goes once that page mounts and shows", async () => {
  followPage("kf-woken");
  await settle();
  assert.deepEqual(followed("kf-woken"), [], "no page yet");
  mount("kf-woken");
  await settle();
  assert.deepEqual(followed("kf-woken"), [], "mounted but not shown");
  showPage("kf-woken", true, shape);
  await settle();
  assert.deepEqual(followed("kf-woken"), followedOnce("kf-woken"));
  await unmountAll();
});

test("the case seen on Windows: the ask outlasts a page that takes longer than the show wait to open, as a new tab with an address does", async () => {
  const opened = slowOpen("kf-slow");
  followPage("kf-slow");
  mount("kf-slow");
  showPage("kf-slow", true, shape);
  await settle();
  later += 5000;
  opened();
  await settle();
  assert.deepEqual(followed("kf-slow"), followedOnce("kf-slow"), "the page opened 5 s after it mounted and still gets the keyboard");
  later = 0;
  await unmountAll();
});

test("dropped when the user goes on to another tab, with or without a page", async () => {
  followPage("kf-left");
  followPage("kf-next");
  mount("kf-left");
  showPage("kf-left", true, shape);
  await settle();
  assert.deepEqual(followed("kf-left"), [], "another tab without a page was switched to");

  mount("kf-shown");
  await settle();
  showPage("kf-shown", true, shape);
  await settle();
  followPage("kf-later");
  followPage("kf-shown");
  mount("kf-later");
  showPage("kf-later", true, shape);
  await settle();
  assert.deepEqual(followed("kf-later"), [], "another tab with a page was switched to");
  await unmountAll();
});

test("dropped when the user presses another page", async () => {
  mount("kf-pressed");
  await settle();
  showPage("kf-pressed", true, shape);
  await settle();
  followPage("kf-unpressed");
  emitTopic("tab", { key: "kf-pressed", name: "pagePress", data: {} });
  mount("kf-unpressed");
  showPage("kf-unpressed", true, shape);
  await settle();
  assert.deepEqual(followed("kf-unpressed"), []);
  await unmountAll();
});

test("dropped when a text field of the app takes the keyboard, even after it lets go again", async () => {
  followPage("kf-field");
  focused = { field: { id: "address" }, windowId: "w" };
  noteFieldAsked("w");
  focused = null;
  mount("kf-field");
  showPage("kf-field", true, shape);
  await settle();
  assert.deepEqual(followed("kf-field"), [], "the address field took the keyboard after the switch");
  await unmountAll();
});

test("never pulls the keyboard out of a field in another window, such as Settings, when the page shows", async () => {
  followPage("kf-settings");
  mount("kf-settings");
  focused = { field: { id: "settings-search" }, windowId: "settings" };
  showPage("kf-settings", true, shape);
  await settle();
  assert.deepEqual(followed("kf-settings"), [], "a Settings field has the keyboard");
  focused = null;
  showPage("kf-settings", false, null);
  showPage("kf-settings", true, { ...shape, width: 210 });
  await settle();
  assert.deepEqual(followed("kf-settings"), [], "and the dropped ask doesn't come back on the next show");
  await unmountAll();
});

test("a kept ask is used once", async () => {
  followPage("kf-once");
  mount("kf-once");
  showPage("kf-once", true, shape);
  await settle();
  showPage("kf-once", false, null);
  showPage("kf-once", true, { ...shape, width: 220 });
  await settle();
  assert.deepEqual(followed("kf-once"), followedOnce("kf-once"));
  await unmountAll();
});

test("each kept ask is counted once as kept, then as used or dropped", async () => {
  takeKeptFollows();
  followPage("kf-count-a");
  followPage("kf-count-a");
  mount("kf-count-a");
  showPage("kf-count-a", true, shape);
  await settle();
  followPage("kf-count-b");
  followPage("kf-count-c");
  focused = { field: { id: "settings-search" }, windowId: "settings" };
  mount("kf-count-c");
  showPage("kf-count-c", true, shape);
  await settle();
  assert.deepEqual(takeKeptFollows(), { kept: 3, used: 1, dropped: 2 });
  assert.deepEqual(takeKeptFollows(), { kept: 0, used: 0, dropped: 0 }, "taking them starts the next hour from zero");
  await unmountAll();
});

test("the counts reach the hourly usage event, and What's Sent names them", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../../../../packages/expo-windows/src/engine/modules.ts"), /takeKeptFollows: \(\) => takeKeptFollows\(\),/);
  assert.match(source("../state/telemetry/keyboardFollowCounts.ts"), /keyboard_follows_kept: kept, keyboard_follows_used: used, keyboard_follows_dropped: dropped/);
  assert.match(source("../state/telemetry/hourlyExtras.ts"), /\.\.\.takeKeyboardFollowCounts\(\)/);
  assert.match(source("../state/telemetry/copy.ts"), /On Windows, how many times a tab you switched to had no page yet/);
});
