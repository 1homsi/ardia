import { StyleSheet } from "react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { SearchTray } from "../components/search/SearchTray";
import { DesignProvider } from "../components/ui";
import { dismissSearch, presentSearch } from "../state/search/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(2);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const open = (design: "original" | "redesigned") => {
  act(() => presentSearch("page"));
  return renderSurface(
    <DesignProvider design={design}>
      <SearchTray />
    </DesignProvider>,
  );
};

const host = (root: ReturnType<typeof renderSurface>, testID: string) => root.root.findAll((node) => node.props.testID === testID && typeof node.type === "string")[0];

test("in the redesign search is a floating panel: 8 points in from the sides and above the keyboard, 26-point corners, the field 9 points in, on a tinted surface over glass", () => {
  const root = open("redesigned");
  const panel = StyleSheet.flatten(host(root, "trayPanel")!.props.style);
  expect(panel).toMatchObject({ position: "absolute", left: 8, right: 8, bottom: 8, borderRadius: 26 });
  expect(panel.boxShadow).toBe("0px 4px 36px rgba(0, 0, 0, 0.1)");
  const fieldArea = root.root.findAll((node) => typeof node.type === "string" && StyleSheet.flatten(node.props.style)?.paddingTop === 9)[0];
  expect(StyleSheet.flatten(fieldArea!.props.style)).toMatchObject({ paddingHorizontal: 9, paddingTop: 9 });
  const tint = host(root, "trayPanel")!.findAll((node) => typeof node.type === "string" && StyleSheet.flatten(node.props.style)?.opacity === 0.55);
  expect(tint.length).toBeGreaterThan(0);
  unmount(root);
});

test("in the original design search is still the sheet from the bottom edge", () => {
  const root = open("original");
  expect(host(root, "trayPanel")).toBeUndefined();
  unmount(root);
});

test("in the redesign a submitted search lifts the panel 120 points and fades it over 200 ms instead of dropping it with the keyboard", () => {
  const root = open("redesigned");
  const panel = () => host(root, "trayPanel");
  const lifted = () => ((getAnimatedStyle(panel()!).transform as { translateY?: number }[]) ?? []).reduce((sum, step) => sum + (step.translateY ?? 0), 0);
  act(() => jest.advanceTimersByTime(600));
  const resting = lifted();
  act(() => dismissSearch("submitted"));
  act(() => jest.advanceTimersByTime(100));
  expect(lifted()).toBeLessThan(resting - 60);
  const halfway = getAnimatedStyle(panel()!).opacity as number;
  expect(halfway).toBeGreaterThan(0);
  expect(halfway).toBeLessThan(1);
  act(() => jest.advanceTimersByTime(150));
  expect(getAnimatedStyle(panel()!).opacity).toBe(0);
  unmount(root);
});
