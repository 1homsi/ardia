import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceEventEmitter, turboModules } from "../test-native/reactNative.ts";

const calls = [];
const opened = [];
const closed = [];
const openIds = new Set();
let refuseWindows = false;

turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    calls.push({ verb, args: JSON.parse(argsJson), windowId });
    return JSON.stringify(verb === "tab.create" ? { tab: calls.length } : { ok: true });
  },
  engineCall: async () => "{}",
};

turboModules.ArdiaAppWindows = {
  openWindow: async (id, options) => {
    opened.push({ id, options });
    if (!refuseWindows) openIds.add(id);
  },
  closeWindow: async (id) => {
    closed.push(id);
    openIds.delete(id);
    DeviceEventEmitter.emit("ArdiaAppWindows:onWindowEvent", { type: "close", id });
  },
  windowFrame: async (id) => (id === "main" ? [100, 50, 1200, 800] : null),
  windowIds: async () => [...openIds],
  setWindowTitle: async () => {},
};

const { mountPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { popupWindowInfo, isPopupWindowId } = await import("../../../../packages/expo-windows/src/engine/popupWindows.ts");

const emitTopic = (topic, payload) => DeviceEventEmitter.emit("ArdiaEngineHost:event", { topic, json: JSON.stringify(payload) });
const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const popupOpened = (adopt, popup, opener = "opener-page") =>
  emitTopic("tab.opened", { adopt, url: "https://auth.example/login", foreground: true, window: true, opener, profile: "p-work", parent: "", fromClick: false, popup });

test("a page's window.open with features opens a pop-up window placed on its opener, and no tab", async () => {
  const events = [];
  const unmount = mountPage("opener-page", { url: "https://app.example/", profile: "p-work", windowId: "main" }, (name, data) => events.push([name, data]));
  await settle();
  popupOpened("ardiacore:1", { width: 400, height: 300 });
  await settle();
  assert.equal(events.filter(([name]) => name === "openWindow").length, 0, "the pop-up never reaches the browser window as a tab");
  const made = opened.at(-1);
  assert.ok(isPopupWindowId(made.id), `the window id ${made.id} is a pop-up id`);
  assert.equal(made.options.kind, "popup");
  assert.deepEqual(made.options.frame, [500, 110, 400, 360]);
  const info = popupWindowInfo(made.id);
  assert.equal(info.adopt, "ardiacore:1");
  assert.equal(info.profile, "p-work");
  assert.equal(info.openerKey, "opener-page");
  assert.equal(info.pageKey, `${made.id}:page`);
  unmount();
});

test("closing a pop-up window closes its tab, and one never mounted gives its offered tab back", async () => {
  const unmount = mountPage("opener-page", { url: "https://app.example/", profile: "p-work", windowId: "main" }, () => {});
  await settle();
  popupOpened("ardiacore:2", {});
  await settle();
  const made = opened.at(-1);
  assert.equal(made.options.frame.join(","), "450,110,500,660");
  const info = popupWindowInfo(made.id);
  const closeShown = mountPage(info.pageKey, { url: "", profile: info.profile, adopt: info.adopt, windowId: made.id }, () => {});
  await settle();
  assert.ok(calls.some((call) => call.verb === "tab.create" && call.args.adopt === "ardiacore:2" && call.windowId === made.id), "the pop-up adopts the engine's tab in its own window");
  turboModules.ArdiaAppWindows.closeWindow(made.id);
  await settle();
  assert.ok(calls.some((call) => call.verb === "tab.close" && call.args.key === info.pageKey), "the tab closes with its window");
  assert.equal(popupWindowInfo(made.id), null);
  closeShown();

  popupOpened("ardiacore:3", {});
  await settle();
  turboModules.ArdiaAppWindows.closeWindow(opened.at(-1).id);
  await settle();
  assert.ok(calls.some((call) => call.verb === "tab.discard" && call.args.adopt === "ardiacore:3"), "an offered tab nobody adopted is discarded");
  unmount();
});

test("a pop-up whose window cannot open goes to its opener as a foreground tab", async () => {
  const warn = console.warn;
  console.warn = () => {};
  refuseWindows = true;
  const events = [];
  const unmount = mountPage("opener-page", { url: "https://app.example/", profile: "p-work", windowId: "main" }, (name, data) => events.push([name, data]));
  await settle();
  popupOpened("ardiacore:4", { x: 10, y: 20 });
  await settle();
  const asked = events.filter(([name]) => name === "openWindow").map(([, data]) => data);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].adoptId, "ardiacore:4");
  assert.equal(asked[0].disposition, "foreground");
  refuseWindows = false;
  console.warn = warn;
  unmount();
});

test("a tab a pop-up opens goes to the pop-up's opener, never into the pop-up", async () => {
  const events = [];
  const unmount = mountPage("opener-page", { url: "https://app.example/", profile: "p-work", windowId: "main" }, (name, data) => events.push([name, data]));
  await settle();
  popupOpened("ardiacore:5", {});
  await settle();
  const made = opened.at(-1);
  const info = popupWindowInfo(made.id);
  const inPopup = [];
  const closeShown = mountPage(info.pageKey, { url: "", profile: info.profile, adopt: info.adopt, windowId: made.id }, (name, data) => inPopup.push([name, data]));
  await settle();
  emitTopic("tab.opened", { adopt: "ardiacore:6", url: "https://help.example/", foreground: true, window: false, opener: info.pageKey, profile: "p-work", fromClick: true, point: { x: 1, y: 2 } });
  await settle();
  assert.equal(inPopup.filter(([name]) => name === "openWindow").length, 0);
  const asked = events.filter(([name]) => name === "openWindow").map(([, data]) => data);
  assert.equal(asked.at(-1).adoptId, "ardiacore:6");
  assert.equal(asked.at(-1).point, undefined, "a click point in the pop-up means nothing in the opener's window");
  closeShown();
  unmount();
});

test("a tab.opened with no popup field still goes to the page as before", async () => {
  const before = opened.length;
  const events = [];
  const unmount = mountPage("opener-page", { url: "https://app.example/", profile: "p-work", windowId: "main" }, (name, data) => events.push([name, data]));
  await settle();
  emitTopic("tab.opened", { adopt: "ardiacore:7", url: "https://x.example/", foreground: true, window: true, opener: "opener-page", profile: "p-work", fromClick: false });
  await settle();
  assert.equal(opened.length, before);
  assert.equal(events.filter(([name]) => name === "openWindow").at(-1)[1].disposition, "window");
  unmount();
});
