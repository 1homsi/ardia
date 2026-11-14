import type { ReactTestInstance } from "react-test-renderer";
import { act } from "react-test-renderer";
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
