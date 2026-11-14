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
