import { PixelRatio, Platform, StyleSheet } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { getAnimatedStyle } from "react-native-reanimated";
import { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { TabDeck } from "../components/tabs/TabDeck";
import { DECK } from "../lib/deckGeometry";
import { NO_LAUNCH_ARGUMENTS, parseLaunchArguments } from "../lib/launchArguments";
import * as launchFlags from "../state/app/launchFlags";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import { pages } from "../platform/pages";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

jest.mock("../platform/lab", () => ({ ...jest.requireActual<object>("../platform/lab"), isLabBuild: true }));

const onAndroid = Platform.OS === "android" ? test : test.skip;
const oniPhone = Platform.OS === "ios" ? test : test.skip;

const RATIO = 2.75;
const TABS = 26;
const START = TABS - 2;
const EXPANDED_Z = 100_000;
const SCREEN_WIDTH = 393;

type Style = { opacity?: number; zIndex?: number; borderRadius?: number; transform?: Record<string, number>[] };

function flagged(on: boolean) {
  jest.spyOn(launchFlags, "launchArguments").mockImplementation(() => (on ? parseLaunchArguments({ ArdiaOneContainerScroll: "1" }) : NO_LAUNCH_ARGUMENTS));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PixelRatio, "get").mockReturnValue(RATIO);
  jest.spyOn(pages, "close").mockImplementation(async () => undefined as never);
  jest.spyOn(pages, "saveState").mockImplementation(async () => null as never);
  withTabs(TABS);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const hosts = (root: ReactTestRenderer, id: string) => root.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const styleOf = (node: ReactTestInstance): Style => (node.props.jestAnimatedStyle ? (getAnimatedStyle(node) as Style) : {});
const shift = (node: ReactTestInstance) => (styleOf(node).transform ?? []).reduce((sum, step) => sum + (step.translateX ?? 0), 0);

function screenLeft(node: ReactTestInstance): number {
  let x = 0;
  for (let at: ReactTestInstance | null = node; at; at = at.parent) if (typeof at.type === "string") x += shift(at);
  return x;
}

const cardLefts = (root: ReactTestRenderer) => hosts(root, "deckCard").map(screenLeft);

function deck(on: boolean) {
  flagged(on);
  const root = renderSurface(<TabDeck />);
  act(() => jest.advanceTimersByTime(400));
  return root;
}

let scrolled = START;
let spacing = 0;

function measureSpacing(root: ReactTestRenderer) {
  const width = StyleSheet.flatten(hosts(root, "deckCard")[0]!.props.style).width as number;
  spacing = Math.min(width, SCREEN_WIDTH * DECK.stepRatio);
  scrolled = START;
}

function panTo(target: number, steps = 1) {
  const from = 200;
  const dx = (scrolled - target) * spacing;
  const moves = Array.from({ length: steps }, (_, step) => ({ state: State.ACTIVE, x: from + (dx * (step + 1)) / steps, y: 400, absoluteX: from + (dx * (step + 1)) / steps, absoluteY: 400, translationX: (dx * (step + 1)) / steps, translationY: 0, velocityX: 0 }));
  act(() => fireGestureHandler(getByGestureTestId("deckPan"), [{ state: State.ACTIVE, x: from, y: 400, absoluteX: from, absoluteY: 400, translationX: 0, translationY: 0, velocityX: 0 }, ...moves]));
  act(() => jest.advanceTimersByTime(16));
  scrolled = target;
}

const layers = (root: ReactTestRenderer) => hosts(root, "deckCardLayer");
const animatedUnder = (node: ReactTestInstance) => [node, ...node.findAll((inner) => typeof inner.type === "string" && inner !== node)].filter((inner) => inner.props.jestAnimatedStyle);
const snapshot = (node: ReactTestInstance) => animatedUnder(node).map((inner) => ({ id: inner.props.testID ?? null, style: JSON.parse(JSON.stringify(styleOf(inner))) as Style }));
const containerX = (root: ReactTestRenderer) => shift(hosts(root, "deckScrollContainer")[0]!);
const slotX = (layer: ReactTestInstance) => shift(layer.findAll((node) => node.props.testID === "deckCardSlot" && typeof node.type === "string")[0]!);

onAndroid("with ArdiaOneContainerScroll, a pan puts every one of 26 cards where the per-card deck puts it, within half a point, at scrolls 0.3, 7.5, 18 and 25", () => {
  for (const target of [0.3, 7.5, 18, 25]) {
    const lefts: number[][] = [];
    for (const on of [false, true]) {
      const root = deck(on);
      expect(hosts(root, "deckScrollContainer")).toHaveLength(on ? 1 : 0);
      measureSpacing(root);
      panTo(target);
      lefts.push(cardLefts(root));
      unmount(root);
      jest.restoreAllMocks();
      jest.spyOn(PixelRatio, "get").mockReturnValue(RATIO);
    }
    const [plain, contained] = lefts as [number[], number[]];
    expect(contained.length).toBe(plain.length);
    expect(plain.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < plain.length; i++) expect(Math.abs(contained[i]! - plain[i]!)).toBeLessThanOrEqual(0.5);
  }
});

onAndroid("with ArdiaOneContainerScroll, between two close scroll positions the cards right of the focus change nothing (only the container moves), and deep-left cards keep every value but their slot, which moves back by exactly what the container moved", () => {
  const root = deck(true);
  measureSpacing(root);
  panTo(22);
  const byIndex = () => new Map(layers(root).map((layer) => [(styleOf(layer).zIndex ?? 0) / 2, layer]));
  const before = new Map([...byIndex()].map(([index, layer]) => [index, { shot: snapshot(layer), slot: slotX(layer) }]));
  const containerBefore = containerX(root);
  panTo(22.3);
  const moved = containerX(root) - containerBefore;
  expect(Math.abs(moved)).toBeGreaterThan(50);
  const keep = (shot: ReturnType<typeof snapshot>) => shot.filter((entry) => entry.id !== "deckCardSlot");
  let right = 0;
  let deep = 0;
  for (const [index, layer] of byIndex()) {
    const was = before.get(index);
    if (!was) continue;
    if (index - 22.3 >= 0) {
      right++;
      expect(snapshot(layer)).toEqual(was.shot);
    }
    if (index - 22 <= -4) {
      deep++;
      expect(keep(snapshot(layer))).toEqual(keep(was.shot));
      expect(slotX(layer) - was.slot).toBeCloseTo(-moved, 6);
    }
  }
  expect(right).toBe(3);
  expect(deep).toBeGreaterThanOrEqual(4);
  unmount(root);
});

onAndroid("with ArdiaOneContainerScroll, mid-scroll every position is on a device pixel and every opacity on a 1/255 step, and a scroll changes only transforms and opacities", () => {
  const root = deck(true);
  measureSpacing(root);
  panTo(21.37);
  const onPixel = (value: number) => Math.abs(value * RATIO - Math.round(value * RATIO)) < 1e-6;
  const onStep = (value: number) => Math.abs(value * 255 - Math.round(value * 255)) < 1e-6;
  const nodes = [hosts(root, "deckScrollContainer")[0]!, ...layers(root).flatMap(animatedUnder)];
  for (const node of nodes) {
    const style = styleOf(node);
    for (const step of style.transform ?? []) for (const [key, value] of Object.entries(step)) if (key.startsWith("translate")) expect(onPixel(value)).toBe(true);
    if (style.opacity !== undefined) expect(onStep(style.opacity)).toBe(true);
  }
  const before = nodes.map((node) => JSON.parse(JSON.stringify(styleOf(node))) as Record<string, unknown>);
  panTo(20.6);
  const changed = new Set<string>();
  nodes.forEach((node, at) => {
    const now = styleOf(node) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(now), ...Object.keys(before[at]!)])) if (JSON.stringify(now[key]) !== JSON.stringify(before[at]![key])) changed.add(key);
  });
  expect([...changed].sort()).toEqual(["opacity", "transform"]);
  unmount(root);
});

function countRuns() {
  let runs = 0;
  type Fn = ((...args: unknown[]) => unknown) & { __closure?: unknown; __workletHash?: number; __initData?: unknown };
  const counted = (fn: Fn): Fn => {
    const wrapped = ((...args: unknown[]) => {
      runs++;
      return fn(...args);
    }) as Fn;
    wrapped.__closure = fn.__closure;
    return wrapped;
  };
  const style = Reanimated.useAnimatedStyle;
  const derived = Reanimated.useDerivedValue;
  const reaction = Reanimated.useAnimatedReaction;
  const inputs = (fn: Fn, deps?: unknown[]) => deps ?? Object.values((fn.__closure ?? {}) as object);
  jest.spyOn(Reanimated, "useAnimatedStyle").mockImplementation(((fn: Fn, deps?: unknown[]) => (style as (...args: unknown[]) => unknown)(counted(fn), inputs(fn, deps))) as never);
  jest.spyOn(Reanimated, "useDerivedValue").mockImplementation(((fn: Fn, deps?: unknown[]) => (derived as (...args: unknown[]) => unknown)(counted(fn), inputs(fn, deps))) as never);
  jest.spyOn(Reanimated, "useAnimatedReaction").mockImplementation(((prepare: Fn, react: Fn, deps?: unknown[]) => (reaction as (...args: unknown[]) => unknown)(counted(prepare), react, inputs(prepare, deps))) as never);
  return { take: () => runs, reset: () => void (runs = 0) };
}

function runsPerFrame(on: boolean) {
  const counter = countRuns();
  const root = deck(on);
  measureSpacing(root);
  panTo(20);
  counter.reset();
  panTo(20, 1);
  const one = counter.take();
  counter.reset();
  panTo(19, 11);
  const eleven = counter.take();
  unmount(root);
  jest.restoreAllMocks();
  jest.spyOn(PixelRatio, "get").mockReturnValue(RATIO);
  return (eleven - one) / 10;
}

onAndroid("with ArdiaOneContainerScroll, a scroll frame at 26 tabs runs a fraction of the per-card deck's worklets", () => {
  const plain = runsPerFrame(false);
  const contained = runsPerFrame(true);
  console.log(`deck scroll frame at ${TABS} tabs: ${plain} worklet runs per scroll frame per-card, ${contained} with one container`);
  expect(plain).toBeGreaterThan(80);
  expect(contained).toBeLessThan(plain / 4);
});

onAndroid("with ArdiaOneContainerScroll, a closed card still fades away and the rest close the gap", () => {
  const root = deck(true);
  act(() => sendDeckCommand({ kind: "closeFocused" }));
  act(() => jest.advanceTimersByTime(64));
  const cards = () => hosts(root, "deckCard").map((card) => styleOf(card));
  expect(cards().some((style) => (style.opacity ?? 1) < 1)).toBe(true);
  act(() => jest.advanceTimersByTime(2000));
  expect(cards().every((style) => style.opacity === 1)).toBe(true);
  unmount(root);
});

onAndroid("with ArdiaOneContainerScroll, a card still opens to full screen above the rest", () => {
  const root = deck(true);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  let grown = 0;
  let raisedFrames = 0;
  for (let frame = 0; frame < 40 && useBrowse.getState().surface === "deck"; frame++) {
    act(() => jest.advanceTimersByTime(16));
    const raised = layers(root).filter((layer) => (styleOf(layer).zIndex ?? 0) >= EXPANDED_Z);
    if (!raised.length) continue;
    expect(raised).toHaveLength(1);
    raisedFrames++;
    const card = raised[0]!.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")[0]!;
    const scale = (styleOf(card).transform ?? []).find((step) => step.scale !== undefined)!.scale!;
    grown = Math.max(grown, scale * (StyleSheet.flatten(card.props.style).width as number));
  }
  expect(raisedFrames).toBeGreaterThan(3);
  expect(grown).toBeCloseTo(SCREEN_WIDTH, 0);
  unmount(root);
});

onAndroid("without ArdiaOneContainerScroll, Android's deck has no container and each card moves itself", () => {
  const root = deck(false);
  expect(hosts(root, "deckScrollContainer")).toHaveLength(0);
  expect(layers(root)).toHaveLength(0);
  unmount(root);
});

oniPhone("on iPhone, ArdiaOneContainerScroll changes nothing: no container, and every card moves itself as before", () => {
  const root = deck(true);
  expect(hosts(root, "deckScrollContainer")).toHaveLength(0);
  expect(layers(root)).toHaveLength(0);
  expect(hosts(root, "deckCard").length).toBeGreaterThanOrEqual(10);
  unmount(root);
});
