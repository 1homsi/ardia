import { Platform, StyleSheet } from "react-native";
import * as reanimated from "react-native-reanimated";
import { getAnimatedStyle } from "react-native-reanimated";
import { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Surfaces } from "../App";
import { DECK } from "../lib/deckGeometry";
import { NO_LAUNCH_ARGUMENTS, parseLaunchArguments } from "../lib/launchArguments";
import * as launchFlags from "../state/app/launchFlags";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import { currentTabs } from "../state/tabs/store";
import * as telemetry from "../state/telemetry/telemetry";
import { landOpeningPage, renderSurface, unmount, withTabs } from "../../test/render/harness";

let mockReportsDrawn = true;
let mockHoldsGrowing = false;
let mockHeldGrowing: (() => void) | null = null;

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual<typeof import("@ardia/phone-native")>("@ardia/phone-native");
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    pageReportsDrawn: () => mockReportsDrawn,
    MotionView: (props: import("@ardia/phone-native").MotionViewProps) => createElement(actual.MotionView, { ...props, onMotionEnd: undefined }),
  };
});
jest.mock("../platform/lab", () => ({ ...jest.requireActual<object>("../platform/lab"), isLabBuild: true }));
jest.mock("../components/tabs/DeckCard", () => {
  const actual = jest.requireActual<typeof import("../components/tabs/DeckCard")>("../components/tabs/DeckCard");
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    OpeningCard: (props: Parameters<typeof actual.OpeningCard>[0]) =>
      createElement(actual.OpeningCard, { ...props, onGrowing: () => (mockHoldsGrowing ? (mockHeldGrowing = props.onGrowing) : props.onGrowing()) }),
  };
});

const onAndroid = Platform.OS === "android" ? test : test.skip;

const LANDS_MS = 278;
const EXPANDED_Z = 100_000;

let counted: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockReportsDrawn = true;
  mockHoldsGrowing = false;
  mockHeldGrowing = null;
  jest.spyOn(launchFlags, "launchArguments").mockImplementation(() => parseLaunchArguments({ ArdiaOpeningCard: "1" }));
  counted = jest.spyOn(telemetry, "countUsage");
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null, veiled: null });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Placed = { x: number; y: number; scale: number; opacity: number; z: number; width: number; height: number };

const placed = (card: ReactTestInstance): Placed => {
  const style = getAnimatedStyle(card) as { opacity?: number; zIndex?: number; transform?: { translateX?: number; translateY?: number; scale?: number }[] };
  const steps = style.transform ?? [];
  const flat = StyleSheet.flatten(card.props.style) as { width: number; height: number };
  return {
    x: steps.reduce((sum, step) => sum + (step.translateX ?? 0), 0),
    y: steps.reduce((sum, step) => sum + (step.translateY ?? 0), 0),
    scale: steps.reduce((value, step) => (step.scale === undefined ? value : step.scale), 1),
    opacity: style.opacity ?? 1,
    z: style.zIndex ?? 0,
    width: flat.width,
    height: flat.height,
  };
};

const deckCards = (root: ReactTestRenderer) => root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string").map(placed);
const motionView = (root: ReactTestRenderer, id: string) => root.root.findAll((node) => node.props.testID === id && typeof node.type !== "string" && node.props.to !== undefined)[0];
const pageView = (root: ReactTestRenderer) => root.root.findAll((node) => typeof node.props.pageId === "string" && typeof node.props.onPageEvent === "function")[0];
const pageOpacity = (root: ReactTestRenderer) => (StyleSheet.flatten(pageView(root)!.props.style) as { opacity?: number }).opacity ?? 1;
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const waited = () => counted.mock.calls.filter(([name]) => name === "card_opens_waited").length;
const cardStops = (root: ReactTestRenderer, finished = true) => act(() => motionView(root, "openingCard")!.props.onMotionEnd(finished));
const openedId = () => {
  const id = useBrowse.getState().opening;
  expect(typeof id).toBe("string");
  return id!;
};
const reportDrawn = (root: ReactTestRenderer) => act(() => pageView(root)!.props.onPageEvent({ nativeEvent: { name: "drawn" } }));

onAndroid("with ArdiaOpeningCard, the opening card mounts in the tap's own commit already growing, from the card's place in the deck to full screen, and ends square-cornered with its bar band shown", () => {
  const root = renderSurface(<Surfaces />);
  const before = deckCards(root);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  const card = motionView(root, "openingCard")!;
  expect(card).toBeDefined();
  const { from, to } = card.props;
  const centerX = from.translateX + 393 / 2;
  const centerY = from.translateY + 873 / 2;
  const tapped = before.reduce((best, now) => (Math.abs(now.x + now.width / 2 - centerX) < Math.abs(best.x + best.width / 2 - centerX) ? now : best));
  expect(tapped.x + tapped.width / 2).toBeCloseTo(centerX, 3);
  expect(tapped.y + tapped.height / 2).toBeCloseTo(centerY, 3);
  expect(from).toMatchObject({ scale: 1, cornerRadius: DECK.cardRadius });
  expect(to).toMatchObject({ translateX: 0, translateY: 0, cornerRadius: 0 });
  expect(to.scale).toBeCloseTo(393 / tapped.width);
  expect(typeof card.props.onMotionEnd).toBe("function");
  const band = motionView(root, "openingCardBand")!;
  expect(band.props.from.translateY).toBeGreaterThan(0);
  expect(band.props.to).toEqual({ translateY: 0 });
  expect(motionView(root, "openingCardFace")!.props.from).toEqual({ translateY: 0 });
  expect(motionView(root, "openingCardFace")!.props.to.translateY).toBeGreaterThan(0);
  expect(motionView(root, "deckChromeFade")!.props.to.opacity).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the tap leaves every deck card's pose alone (no expanded card yet), and the opening card's mount hides the tapped card and gives it the expanded role in one worklet, before any spring", () => {
  mockHoldsGrowing = true;
  const root = renderSurface(<Surfaces />);
  const before = deckCards(root);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(motionView(root, "openingCard")).toBeDefined();
  expect(mockHeldGrowing).not.toBeNull();
  expect(deckCards(root)).toEqual(before);
  advance(64);
  expect(deckCards(root)).toEqual(before);
  expect(useBrowse.getState().opening).toBeNull();
  const worklets = jest.spyOn(reanimated, "runOnUI");
  act(() => mockHeldGrowing!());
  expect(worklets).toHaveBeenCalledTimes(1);
  worklets.mockRestore();
  for (let frame = 0; frame < 8; frame++) {
    advance(16);
    for (const card of deckCards(root)) expect(card.z >= EXPANDED_Z).toBe(card.opacity === 0);
  }
  const now = deckCards(root);
  const hidden = now.filter((card) => card.opacity === 0);
  expect(hidden).toHaveLength(1);
  expect(hidden[0]!.z).toBeGreaterThanOrEqual(EXPANDED_Z);
  expect(now.some((card, index) => card.opacity > 0 && card.x !== before[index]!.x)).toBe(true);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the page isn't made in the tap's commit but a frame after the growth starts, veiled at opacity 0", () => {
  const root = renderSurface(<Surfaces />);
  const selected = currentTabs().selectedId;
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(motionView(root, "openingCard")).toBeDefined();
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", opening: null });
  expect(currentTabs().selectedId).toBe(selected);
  expect(pageView(root)).toBeUndefined();
  advance(16);
  const id = openedId();
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", opening: id, veiled: id });
  expect(pageView(root)!.props.pageId).toBe(id);
  expect(pageOpacity(root)).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the page is unveiled when the opening card's motion ends, not on a timer, and the deck's cards go straight to their end then", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS + 100);
  const id = openedId();
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", veiled: id });
  expect(pageOpacity(root)).toBe(0);
  cardStops(root, false);
  expect(useBrowse.getState().veiled).toBe(id);
  cardStops(root);
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", veiled: null });
  expect(pageOpacity(root)).toBe(1);
  const landed = deckCards(root);
  advance(48);
  expect(deckCards(root)).toEqual(landed);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, an opening card whose motion end never comes still unveils the page at twice the landing time", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(2 * LANDS_MS - 8);
  const id = openedId();
  expect(useBrowse.getState().veiled).toBe(id);
  advance(16);
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", veiled: null });
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the page takes over in the same call as its drawn report after the card stops, and that open isn't counted as waited", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS);
  cardStops(root);
  advance(100);
  expect(useBrowse.getState().surface).toBe("deck");
  reportDrawn(root);
  expect(useBrowse.getState()).toMatchObject({ surface: "browsing", opening: null, veiled: null });
  expect(waited()).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, a page that never reports drawn takes over 200 ms after the card stops, never later, and only that open is counted as waited", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS);
  cardStops(root);
  advance(199);
  expect(useBrowse.getState().surface).toBe("deck");
  expect(waited()).toBe(0);
  advance(1);
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(waited()).toBe(1);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, a card that stops before the page is made still makes it, shown, and hands over on drawn", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(useBrowse.getState().opening).toBeNull();
  cardStops(root);
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", opening: openedId(), veiled: null });
  advance(16);
  expect(useBrowse.getState().veiled).toBeNull();
  reportDrawn(root);
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(waited()).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard where the page view can't report drawn, the page takes over when the card stops once it has laid out, as without it", () => {
  mockReportsDrawn = false;
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(16);
  landOpeningPage(root);
  advance(LANDS_MS + 100);
  expect(useBrowse.getState().surface).toBe("deck");
  cardStops(root);
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(waited()).toBe(0);
  unmount(root);
});

onAndroid("without ArdiaOpeningCard, Android opens a card as before: no opening card and no page while the card grows", () => {
  jest.spyOn(launchFlags, "launchArguments").mockImplementation(() => NO_LAUNCH_ARGUMENTS);
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  for (let frame = 0; frame < 6; frame++) {
    advance(16);
    expect(motionView(root, "openingCard")).toBeUndefined();
    expect(useBrowse.getState().opening).toBeNull();
  }
  unmount(root);
});

onAndroid("after an open through the opening card, the deck reopens settled and opens another card the same way", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS);
  cardStops(root);
  reportDrawn(root);
  expect(useBrowse.getState().surface).toBe("browsing");
  act(() => useBrowse.setState({ surface: "deck", deckEntrance: null, opening: null, veiled: null }));
  advance(1000);
  expect(motionView(root, "openingCard")).toBeUndefined();
  expect(deckCards(root).every((card) => card.opacity === 1 && card.z < EXPANDED_Z)).toBe(true);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(motionView(root, "openingCard")).toBeDefined();
  advance(LANDS_MS);
  cardStops(root);
  reportDrawn(root);
  expect(useBrowse.getState().surface).toBe("browsing");
  unmount(root);
});
