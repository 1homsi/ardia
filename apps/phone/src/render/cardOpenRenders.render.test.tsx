import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { Surfaces } from "../App";
import * as perf from "../state/app/interactionPerf";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(9);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  renders = [];
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    renders.push(component);
  });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const LAYOUT_KEYS = ["width", "height", "top", "left", "right", "bottom", "margin", "padding", "flex"];

test("a card open mounts the page and its cover once each, before the spring, and renders neither again through the hand-over; the growing card animates no layout", () => {
  const root = renderSurface(<Surfaces />);
  renders = [];
  act(() => sendDeckCommand({ kind: "openFocused" }));
  const page = root.root.findAll((node) => (node.type as { name?: string })?.name === "BrowsingScreen")[0]!;
  expect(page).toBeDefined();
  const mounted = { screen: renders.filter((name) => name === "BrowsingScreen").length, cover: renders.filter((name) => name === "PageCover").length };
  expect(mounted).toEqual({ screen: 1, cover: 1 });
  const screen = page.findAll((node) => typeof node.type === "string" && typeof node.props.onLayout === "function")[0]!;
  act(() => screen.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 873 } } }));
  const seen = new Map<string, Set<string>>();
  for (let frame = 0; frame < 60 && useBrowse.getState().surface === "deck"; frame++) {
    act(() => jest.advanceTimersByTime(16));
    root.root
      .findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")
      .forEach((card, index) => {
        for (const [key, value] of Object.entries(getAnimatedStyle(card) ?? {})) {
          const values = seen.get(`${index}:${key}`) ?? new Set<string>();
          values.add(JSON.stringify(value));
          seen.set(`${index}:${key}`, values);
        }
      });
  }
  expect(useBrowse.getState().surface).toBe("browsing");
  act(() => jest.advanceTimersByTime(1000));
  expect(renders.filter((name) => name === "BrowsingScreen")).toHaveLength(1);
  expect(renders.filter((name) => name === "PageCover")).toHaveLength(1);
  const changing = [...seen.entries()].filter(([, values]) => values.size > 1).map(([key]) => key.split(":")[1]!);
  expect(changing).toEqual(expect.arrayContaining(["transform"]));
  expect(changing.filter((key) => LAYOUT_KEYS.some((layout) => key.toLowerCase().startsWith(layout)))).toEqual([]);
  unmount(root);
});
