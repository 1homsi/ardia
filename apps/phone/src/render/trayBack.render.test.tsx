import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";

type Handlers = { onProgress?: (progress: number, edge: "left" | "right") => void; onCancel?: () => void; onCommit?: () => void };

const mockBack = { enabled: [] as boolean[], handlers: null as Handlers | null };

jest.mock("../platform/back", () => ({
  TRAY_BACK_TRAVEL: 72,
  trayBack: {
    setEnabled: (on: boolean) => mockBack.enabled.push(on),
    listen: (handlers: Handlers) => {
      mockBack.handlers = handlers;
      return { remove: () => (mockBack.handlers = null) };
    },
  },
}));

const { SearchTray } = require("../components/search/SearchTray") as typeof import("../components/search/SearchTray");
const { presentSearch, useSearch } = require("../state/search/store") as typeof import("../state/search/store");
const { renderSurface, unmount, withTabs } = require("../../test/render/harness") as typeof import("../../test/render/harness");

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
  mockBack.enabled = [];
  mockBack.handlers = null;
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const sheet = (root: ReturnType<typeof renderSurface>) =>
  root.root.findAll((node) => (node.props.testID === "trayPanel" || typeof node.props.style === "object") && typeof node.type === "string" && getAnimatedStyle(node)?.transform !== undefined && node.props.testID !== "trayDim")[0]!;
const lift = (node: ReturnType<typeof sheet>) => ((getAnimatedStyle(node).transform as { translateY?: number }[]) ?? []).reduce((sum, step) => sum + (step.translateY ?? 0), 0);

test("while the tray is up, Android's predictive back follows the swipe down by up to 72 points, springs back on cancel, closes on commit, and is switched off once the tray goes", () => {
  act(() => presentSearch("page", "otters"));
  const root = renderSurface(<SearchTray />);
  act(() => jest.advanceTimersByTime(600));
  expect(mockBack.enabled).toEqual([true]);
  const node = sheet(root);
  const resting = lift(node);
  act(() => mockBack.handlers!.onProgress!(0.5, "left"));
  act(() => jest.advanceTimersByTime(16));
  expect(lift(node) - resting).toBeCloseTo(36, 0);
  act(() => mockBack.handlers!.onCancel!());
  act(() => jest.advanceTimersByTime(800));
  expect(lift(node) - resting).toBeCloseTo(0, 0);
  act(() => mockBack.handlers!.onCommit!());
  expect(useSearch.getState().open).toBe(false);
  act(() => jest.advanceTimersByTime(16));
  expect(mockBack.enabled).toEqual([true, false]);
  unmount(root);
});
