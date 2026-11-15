import { StyleSheet } from "react-native";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { TabDeck } from "../components/tabs/TabDeck";
import * as perf from "../state/app/interactionPerf";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import { currentTabs } from "../state/tabs/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(9);
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

const cardRenders = () => renders.filter((component) => component === "DeckCard").length;

type Root = ReturnType<typeof renderSurface>;

const cardZ = (root: Root) =>
  root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string").map((card) => (getAnimatedStyle(card).zIndex as number | undefined) ?? 0);

test("opening one card from the deck renders no card again: the opened card's role, its place on top and its neighbours' slide all run on the UI thread", () => {
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<TabDeck />);
  const mounted = cardRenders();
  expect(mounted).toBeGreaterThan(0);
  expect(Math.max(...cardZ(root))).toBeLessThan(100_000);
  renders = [];
  act(() => sendDeckCommand({ kind: "openFocused" }));
  act(() => jest.advanceTimersByTime(16 * 18));
  expect(cardRenders()).toBe(0);
  expect(Math.max(...cardZ(root))).toBeGreaterThanOrEqual(100_000);
  expect(cardZ(root).filter((z) => z >= 100_000)).toHaveLength(1);
  unmount(root);
});

test("opening the deck from a page renders each mounted card once, and its spring settling renders none again", () => {
  const entrance = currentTabs().selectedId!;
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: entrance, frozenOrder: null, opening: null });
  const root = renderSurface(<TabDeck />, { flushTimers: false });
  const mounted = cardRenders();
  act(() => jest.advanceTimersByTime(16));
  expect(cardZ(root).filter((z) => z >= 100_000)).toHaveLength(1);
  act(() => jest.advanceTimersByTime(3000));
  expect(cardRenders()).toBe(mounted);
  expect(Math.max(...cardZ(root))).toBeLessThan(100_000);
  expect(root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")).toHaveLength(mounted);
  unmount(root);
});

test("a deck open never resizes the cards' container, and once it has settled nothing about the cards changes for two seconds: no card renders and no card style, so the phone redraws no card late", () => {
  const entrance = currentTabs().selectedId!;
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: entrance, frozenOrder: null, opening: null });
  const root = renderSurface(<TabDeck />, { flushTimers: false });
  const cards = () => root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string");
  const containerHeight = () => StyleSheet.flatten(root.root.findAll((node) => node.props.testID === "deckCards" && typeof node.type === "string")[0]!.props.style).height;
  const cardStyles = () => JSON.stringify(cards().map((card) => [StyleSheet.flatten(card.props.style), getAnimatedStyle(card)]));
  const heights = new Set([containerHeight()]);
  let settledAt = -1;
  for (let frame = 0; frame < 300; frame++) {
    act(() => jest.advanceTimersByTime(16));
    heights.add(containerHeight());
    if (settledAt < 0 && frame > 2 && Math.max(...cardZ(root)) < 100_000) settledAt = frame;
    if (settledAt >= 0 && frame === settledAt + 1) {
      const rendersAtRest = cardRenders();
      const atRest = cardStyles();
      for (let later = 0; later < 125; later++) {
        act(() => jest.advanceTimersByTime(16));
        heights.add(containerHeight());
      }
      expect(cardRenders()).toBe(rendersAtRest);
      expect(cardStyles()).toBe(atRest);
      break;
    }
  }
  expect(settledAt).toBeGreaterThan(0);
  expect([...heights]).toEqual([873]);
  unmount(root);
});

test("a touch in the band above the deck bar starts no card gesture, the clearance the cards' container used to give by ending there", () => {
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<TabDeck />);
  const slop = (getByGestureTestId("deckPan") as unknown as { config: { hitSlop?: { bottom?: number } } }).config.hitSlop;
  expect(slop?.bottom).toBeLessThan(-40);
  unmount(root);
});
