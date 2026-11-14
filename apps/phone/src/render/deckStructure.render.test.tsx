import type { ReactTestInstance } from "react-test-renderer";
import * as Reanimated from "react-native-reanimated";
import { act } from "react-test-renderer";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { TabDeck } from "../components/tabs/TabDeck";
import { useBrowse } from "../state/browse/store";
import { useTabs } from "../state/tabs/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(9);
  useTabs.setState((state) => ({ ...state, open: state.open.map((tab, index) => ({ ...tab, snapshotFileName: `file:///snapshots/card-${index}.jpg` })) }));
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const hostsUnder = (node: ReactTestInstance) => node.findAll((inner) => typeof inner.type === "string" && inner !== node);

function loadedDeck() {
  const root = renderSurface(<TabDeck />);
  const images = root.root.findAll((node) => typeof node.type === "string" && node.type === "Image" && typeof node.props.onLoad === "function");
  act(() => images.forEach((image) => image.props.onLoad({ nativeEvent: { source: { width: 600, height: 1300 } } })));
  act(() => jest.advanceTimersByTime(400));
  return root;
}

const cards = (root: ReturnType<typeof renderSurface>) => root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string");

test("once a card's picture has faded in, the placeholder face under it is gone: one image and no text left in each of nine cards", () => {
  const root = loadedDeck();
  expect(cards(root).length).toBeGreaterThanOrEqual(7);
  for (const card of cards(root)) {
    const inside = hostsUnder(card);
    expect(inside.filter((node) => node.type === "Image")).toHaveLength(1);
    expect(inside.filter((node) => node.type === "Text")).toHaveLength(0);
  }
  unmount(root);
});

const LAYOUT_KEYS = ["width", "height", "top", "left", "right", "bottom", "minWidth", "maxWidth", "minHeight", "maxHeight", "margin", "marginTop", "marginLeft", "padding", "paddingTop", "flex", "flexBasis", "aspectRatio"];

test("a deck scroll animates only transforms and opacity, so no animated style asks for a layout pass while nine cards move", () => {
  const animatedKeys = new Set<string>();
  const original = Reanimated.useAnimatedStyle;
  const recording = jest.spyOn(Reanimated, "useAnimatedStyle").mockImplementation(((updater: (() => Record<string, unknown>) & { __closure?: Record<string, unknown> }, deps?: unknown[]) =>
    (original as (...args: unknown[]) => unknown)(() => {
      const out = updater();
      for (const key of Object.keys(out ?? {})) animatedKeys.add(key);
      return out;
    }, deps ?? Object.values(updater.__closure ?? {}))) as never);
  const root = loadedDeck();
  act(() => sendDeckCommand({ kind: "scroll", index: 2 }));
  for (let frame = 0; frame < 30; frame++) act(() => jest.advanceTimersByTime(16));
  recording.mockRestore();
  expect(animatedKeys.has("transform")).toBe(true);
  expect([...animatedKeys].filter((key) => LAYOUT_KEYS.includes(key))).toEqual([]);
  unmount(root);
});
