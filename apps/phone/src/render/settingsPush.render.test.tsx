import { Platform, StyleSheet } from "react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { act, type ReactTestInstance } from "react-test-renderer";
import { renderSurface, unmount, updateSurface } from "../../test/render/harness";

const mockMotion = { reduced: false };

jest.mock("../state/app/systemLook", () => ({ ...jest.requireActual("../state/app/systemLook"), useReduceMotion: () => mockMotion.reduced }));

const { SettingsView } = require("../components/settings/SettingsView") as typeof import("../components/settings/SettingsView");
const { sharedAxisMotion } = require("../components/ui/motion") as typeof import("../components/ui/motion");
const nav = require("../state/settings/nav") as typeof import("../state/settings/nav");

const onAndroid = Platform.OS === "android" ? test : test.skip;

type Root = ReturnType<typeof renderSurface>;

beforeEach(() => {
  jest.useFakeTimers();
  mockMotion.reduced = false;
});

afterEach(() => {
  act(() => nav.closeSettings());
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const layers = (root: Root) => root.root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("settingsLayer:"));
const roles = (root: Root) => layers(root).map((node) => (node.props.testID as string).slice("settingsLayer:".length));
const layer = (root: Root, role: string) => layers(root).find((node) => node.props.testID === `settingsLayer:${role}`)!;
const pose = (node: ReactTestInstance) => {
  const style = getAnimatedStyle(node) as { opacity?: number; transform?: Record<string, number>[] };
  return { opacity: style.opacity ?? 1, x: Object.assign({}, ...(style.transform ?? [])).translateX ?? 0 };
};
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));
const titleOf = (node: ReactTestInstance) => node.findAll((child) => child.props.testID === "settingsTitle" && typeof child.type === "string").map((child) => child.props.children)[0];

function settings() {
  act(() => nav.openSettings());
  const root = renderSurface(<SettingsView />);
  advance(50);
  return root;
}

onAndroid("on Android a Settings page arrives on Material's shared X axis: the whole old page, bar and paint, fades out within the first 35% while moving 30 dp aside, the whole new one fades in after it from 30 dp the other way, and after 300 ms one settled page remains over the sheet's own backdrop", () => {
  const root = settings();
  expect(roles(root)).toEqual(["settled"]);
  expect(root.root.findAll((node) => node.props.testID === "settingsStack" && typeof node.type === "string")).toHaveLength(1);
  act(() => nav.pushSettings({ page: "about" }));
  expect(roles(root)).toEqual(["outgoing", "incoming"]);
  expect(layer(root, "outgoing").props.pointerEvents).toBe("none");
  expect(layer(root, "outgoing").props.importantForAccessibility).toBe("no-hide-descendants");
  expect(titleOf(layer(root, "incoming"))).toBe("About Ardia");
  expect(pose(layer(root, "incoming"))).toEqual({ opacity: 0, x: sharedAxisMotion.slide });
  advance(sharedAxisMotion.ms * sharedAxisMotion.handoff + 16);
  const out = pose(layer(root, "outgoing"));
  expect(out.opacity).toBe(0);
  expect(out.x).toBeLessThan(0);
  expect(out.x).toBeGreaterThan(-sharedAxisMotion.slide);
  const coming = pose(layer(root, "incoming"));
  expect(coming.x).toBeGreaterThan(0);
  expect(coming.x).toBeLessThan(sharedAxisMotion.slide);
  advance(sharedAxisMotion.ms);
  expect(roles(root)).toEqual(["settled"]);
  expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
  expect(titleOf(layer(root, "settled"))).toBe("About Ardia");
  unmount(root);
});

onAndroid("on Android going back runs the same axis the other way: the page underneath comes in from the left as the page on top leaves to the right", () => {
  const root = settings();
  act(() => nav.pushSettings({ page: "about" }));
  advance(sharedAxisMotion.settleCapMs);
  expect(roles(root)).toEqual(["settled"]);
  act(() => void nav.popSettings());
  expect(roles(root)).toEqual(["outgoing", "incoming"]);
  expect(titleOf(layer(root, "outgoing"))).toBe("About Ardia");
  expect(pose(layer(root, "incoming"))).toEqual({ opacity: 0, x: -sharedAxisMotion.slide });
  advance(sharedAxisMotion.ms / 2);
  expect(pose(layer(root, "outgoing")).x).toBeGreaterThan(0);
  advance(sharedAxisMotion.ms);
  expect(roles(root)).toEqual(["settled"]);
  unmount(root);
});

onAndroid("on Android with Remove animations a Settings page swaps in one cut: one layer, at rest, the moment it is pushed or popped", () => {
  mockMotion.reduced = true;
  const root = settings();
  act(() => nav.pushSettings({ page: "about" }));
  expect(roles(root)).toEqual(["settled"]);
  expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
  expect(titleOf(layer(root, "settled"))).toBe("About Ardia");
  act(() => void nav.popSettings());
  expect(roles(root)).toEqual(["settled"]);
  expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
  unmount(root);
});

onAndroid("on Android closing and reopening Settings never slides a page in: the sheet carries the last page away and the next open starts at rest", () => {
  const root = settings();
  act(() => nav.pushSettings({ page: "about" }));
  advance(50);
  act(() => nav.closeSettings());
  expect(roles(root)).toEqual(["settled"]);
  expect(titleOf(layer(root, "settled"))).toBe("About Ardia");
  act(() => nav.openSettings());
  expect(roles(root)).toEqual(["settled"]);
  expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
  expect(StyleSheet.flatten(layer(root, "settled").props.style).position).toBe("absolute");
  unmount(root);
});

for (const elapsed of [50, 150]) {
  onAndroid(`a second Settings push or Back at ${elapsed} ms shows its destination immediately`, () => {
    const root = settings();
    act(() => nav.pushSettings({ page: "about" }));
    advance(elapsed);
    act(() => nav.pushSettings({ page: "licenses" }));
    expect(roles(root)).toEqual(["settled"]);
    expect(titleOf(layer(root, "settled"))).toBe("Open Source Licenses");
    expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
    act(() => void nav.popSettings());
    advance(elapsed);
    act(() => void nav.popSettings());
    expect(roles(root)).toEqual(["settled"]);
    expect(titleOf(layer(root, "settled"))).toBe("Settings");
    expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
    unmount(root);
  });
}

onAndroid("turning Remove animations on during a push settles the current Settings page immediately", () => {
  const root = settings();
  act(() => nav.pushSettings({ page: "about" }));
  advance(50);
  mockMotion.reduced = true;
  updateSurface(root, <SettingsView />);
  expect(roles(root)).toEqual(["settled"]);
  expect(titleOf(layer(root, "settled"))).toBe("About Ardia");
  expect(pose(layer(root, "settled"))).toEqual({ opacity: 1, x: 0 });
  unmount(root);
});
