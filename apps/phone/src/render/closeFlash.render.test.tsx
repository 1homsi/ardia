import { getAnimatedStyle, makeMutable } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { DECK_PHASE, DeckCard, type DeckMotion } from "../components/tabs/DeckCard";
import { deckGeometry } from "../lib/deckGeometry";
import { renderSurface, someTabs, unmount } from "../../test/render/harness";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const motion = (): DeckMotion => ({
  orderIds: makeMutable<readonly string[]>(["t0", "t1", "t2"]),
  shiftBy: makeMutable(0),
  phase: makeMutable<number>(DECK_PHASE.settled),
  expandedIndex: makeMutable(-1),
  scroll: makeMutable(1),
  scaleProgress: makeMutable(1),
  positionProgress: makeMutable(1),
  dragIndex: makeMutable(-1),
  dragLift: makeMutable(0),
  flyIndex: makeMutable(-1),
  flyLift: makeMutable(0),
  flyVanish: makeMutable(0),
});

test("a card that has vanished stays vanished when the deck resets its fly-away values before React removes the card, so the closed card never flashes back at its old place", () => {
  const moves = motion();
  const tab = someTabs(3)[1]!;
  const root = renderSurface(
    <DeckCard tab={tab} index={1} geometry={deckGeometry(393, 873, 40, 24)} motion={moves} onOpen={() => undefined} onClose={() => undefined} onCloseNow={() => undefined} />,
  );
  const card = () => root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")[0]!;
  const opacity = () => (getAnimatedStyle(card()).opacity as number | undefined) ?? 1;
  expect(opacity()).toBe(1);
  act(() => {
    moves.flyIndex.value = 1;
    moves.flyVanish.value = 1;
  });
  act(() => jest.advanceTimersByTime(16));
  expect(opacity()).toBe(0);
  act(() => {
    moves.flyIndex.value = -1;
    moves.flyVanish.value = 0;
    moves.flyLift.value = 0;
  });
  act(() => jest.advanceTimersByTime(16));
  expect(opacity()).toBe(0);
  unmount(root);
});
