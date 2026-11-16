import { Platform, StyleSheet } from "react-native";
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

jest.mock("@ardia/phone-native", () => ({ ...jest.requireActual<object>("@ardia/phone-native"), pageReportsDrawn: () => mockReportsDrawn }));
jest.mock("../platform/lab", () => ({ ...jest.requireActual<object>("../platform/lab"), isLabBuild: true }));

const onAndroid = Platform.OS === "android" ? test : test.skip;

const LANDS_MS = 278;

let counted: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockReportsDrawn = true;
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

type Placed = { x: number; y: number; scale: number; opacity: number; width: number; height: number };

const placed = (card: ReactTestInstance): Placed => {
  const style = getAnimatedStyle(card) as { opacity?: number; transform?: { translateX?: number; translateY?: number; scale?: number }[] };
  const steps = style.transform ?? [];
  const flat = StyleSheet.flatten(card.props.style) as { width: number; height: number };
  return {
    x: steps.reduce((sum, step) => sum + (step.translateX ?? 0), 0),
    y: steps.reduce((sum, step) => sum + (step.translateY ?? 0), 0),
    scale: steps.reduce((value, step) => (step.scale === undefined ? value : step.scale), 1),
    opacity: style.opacity ?? 1,
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

onAndroid("with ArdiaOpeningCard, the opening card mounts in the tap's own commit already growing, from the card's place in the deck to full screen with the display's corners", () => {
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
  expect(to).toMatchObject({ translateX: 0, translateY: 0 });
  expect(to.scale).toBeCloseTo(393 / tapped.width);
  expect(to.cornerRadius * to.scale).toBeCloseTo(DECK.displayCornerRadius);
  expect(motionView(root, "openingCardFace")!.props.from).toEqual({ translateY: 0 });
  expect(motionView(root, "openingCardFace")!.props.to.translateY).toBeGreaterThan(0);
  expect(motionView(root, "deckChromeFade")!.props.to.opacity).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, no deck card moves or hides before the opening card is mounted, so the open starts without a flash, and the tapped card hides a frame later under it", () => {
  const root = renderSurface(<Surfaces />);
  const before = deckCards(root);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(motionView(root, "openingCard")).toBeDefined();
  expect(deckCards(root)).toEqual(before);
  advance(16);
  const covered = deckCards(root).filter((card) => card.opacity === 0);
  expect(covered).toHaveLength(1);
  advance(48);
  expect(deckCards(root).some((card, index) => card.opacity > 0 && card.x !== before[index]!.x)).toBe(true);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the page is made at the tap with its view at opacity 0, shown at landing, and the deck's cards go straight to their end once the opening card covers them all", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  const id = currentTabs().selectedId!;
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", opening: id, veiled: id });
  expect(pageView(root)!.props.pageId).toBe(id);
  expect(pageOpacity(root)).toBe(0);
  advance(LANDS_MS - 8);
  expect(pageOpacity(root)).toBe(0);
  advance(16);
  expect(useBrowse.getState()).toMatchObject({ surface: "deck", veiled: null });
  expect(pageOpacity(root)).toBe(1);
  const landed = deckCards(root);
  advance(48);
  expect(deckCards(root)).toEqual(landed);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, the page takes over as soon as it reports drawn after landing, and that open isn't counted as waited", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS + 8);
  advance(100);
  expect(useBrowse.getState().surface).toBe("deck");
  act(() => pageView(root)!.props.onPageEvent({ nativeEvent: { name: "drawn" } }));
  expect(useBrowse.getState()).toMatchObject({ surface: "browsing", opening: null, veiled: null });
  expect(waited()).toBe(0);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard, a page that never reports drawn takes over 200 ms after landing, never later, and that open is counted as waited", () => {
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  advance(LANDS_MS + 1 + 198);
  expect(useBrowse.getState().surface).toBe("deck");
  expect(waited()).toBe(0);
  advance(2);
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(waited()).toBe(1);
  unmount(root);
});

onAndroid("with ArdiaOpeningCard where the page view can't report drawn, the page takes over at landing once it has laid out, as without it", () => {
  mockReportsDrawn = false;
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  landOpeningPage(root);
  advance(LANDS_MS - 8);
  expect(useBrowse.getState().surface).toBe("deck");
  advance(16);
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
  advance(LANDS_MS + 8);
  act(() => pageView(root)!.props.onPageEvent({ nativeEvent: { name: "drawn" } }));
  expect(useBrowse.getState().surface).toBe("browsing");
  act(() => useBrowse.setState({ surface: "deck", deckEntrance: null, opening: null, veiled: null }));
  advance(1000);
  expect(motionView(root, "openingCard")).toBeUndefined();
  expect(deckCards(root).every((card) => card.opacity === 1)).toBe(true);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(motionView(root, "openingCard")).toBeDefined();
  advance(LANDS_MS + 8);
  act(() => pageView(root)!.props.onPageEvent({ nativeEvent: { name: "drawn" } }));
  expect(useBrowse.getState().surface).toBe("browsing");
  unmount(root);
});
