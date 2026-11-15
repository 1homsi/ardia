import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { DECK, deckGeometry } from "../lib/deckGeometry";
import { Surfaces } from "../App";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import * as pages from "../state/pages/store";
import { currentTabs } from "../state/tabs/store";
import { framesUntil, landOpeningPage, renderSurface, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("opening a card makes its page under the deck two frames after the card starts growing, so the growth reaches Core Animation before the mount, and that same page stays in front, never made twice", () => {
  const registered = jest.spyOn(pages, "registerPageHandle");
  const registrations = (handle: "made" | "ended") => registered.mock.calls.filter((call) => (call[1] === null) === (handle === "ended")).length;
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  for (let frame = 0; frame < 6; frame++) act(() => jest.advanceTimersByTime(16));
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", opening: currentTabs().selectedId });
  expect(registrations("made")).toBeGreaterThan(0);
  act(() => jest.advanceTimersByTime(3000));
  expect(useBrowse.getState()).toMatchObject({ surface: "browsing", opening: null });
  expect(registrations("ended")).toBe(0);
  unmount(root);
  expect(registrations("ended")).toBe(1);
  registered.mockRestore();
});

test("the opening card is one view on top of the deck that grows from the card's place to full screen with the display's corners, and the deck card under it hides once it starts", () => {
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  const opening = (id: string) => root.root.findAll((node) => node.props.testID === id && typeof node.type !== "string" && node.props.to !== undefined)[0];
  act(() => sendDeckCommand({ kind: "openFocused" }));
  const start = opening("openingCard")!.props.to;
  expect(start.scale).toBe(1);
  expect(start.cornerRadius).toBe(DECK.cardRadius);
  act(() => jest.advanceTimersByTime(48));
  const g = deckGeometry(393, 873, 40, 24);
  const full = opening("openingCard")!.props.to;
  expect(full).toMatchObject({ translateX: 0, translateY: 0 });
  expect(full.scale).toBeCloseTo(g.width / g.cardWidth);
  expect(full.cornerRadius * full.scale).toBeCloseTo(DECK.displayCornerRadius);
  const strip = opening("openingCardFace")!.props.to.translateY * full.scale;
  expect(strip).toBeGreaterThan(36);
  expect(strip).toBeLessThanOrEqual(40.001);
  const card = root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string").find((node) => getAnimatedStyle(node).opacity === 0);
  expect(card).toBeTruthy();
  unmount(root);
});

test("the deck takes taps and a card's page takes over as soon as its spring is within Compose's settle point and the page has drawn, well under half a second", () => {
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  let elapsed = 0;
  let landed = false;
  while (useBrowse.getState().surface === "deck" && elapsed < 1000) {
    act(() => jest.advanceTimersByTime(16));
    elapsed += 16;
    if (!landed && useBrowse.getState().opening !== null) landed = landOpeningPage(root);
  }
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(elapsed).toBeLessThan(450);
  unmount(root);
});
