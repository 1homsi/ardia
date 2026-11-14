import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { deckGeometry } from "../lib/deckGeometry";
import { Surfaces } from "../App";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
import * as pages from "../state/pages/store";
import { currentTabs } from "../state/tabs/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("opening a card makes its page under the deck as the spring starts, and that same page stays in front, never made twice", () => {
  const registered = jest.spyOn(pages, "registerPageHandle");
  const registrations = (handle: "made" | "ended") => registered.mock.calls.filter((call) => (call[1] === null) === (handle === "ended")).length;
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  expect(registrations("made")).toBe(0);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(useBrowse.getState().surface).toBe("deck");
  expect(useBrowse.getState().opening).toBe(currentTabs().selectedId);
  expect(registrations("made")).toBeGreaterThan(0);
  act(() => jest.advanceTimersByTime(3000));
  expect(useBrowse.getState()).toMatchObject({ surface: "browsing", opening: null });
  expect(registrations("ended")).toBe(0);
  unmount(root);
  expect(registrations("ended")).toBe(1);
  registered.mockRestore();
});

test("an open interrupted before its spring ends takes the page out from under the deck again", () => {
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  expect(useBrowse.getState().opening).not.toBeNull();
  act(() => useBrowse.setState({ surface: "deck", opening: null }));
  expect(root.root.findAll((node) => (node.type as { name?: string })?.name === "BrowsingScreen")).toHaveLength(0);
  unmount(root);
});

test("an opening card grows a status-bar strip in the page's tone above its picture, so at full size the picture lands where the live page starts", () => {
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  const strips = () => root.root.findAll((node) => node.props.testID === "deckCardStatusStrip" && typeof node.type === "string");
  expect(strips().every((strip) => (getAnimatedStyle(strip).height ?? 0) === 0)).toBe(true);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  let grown = 0;
  for (let frame = 0; frame < 120 && useBrowse.getState().surface === "deck"; frame++) {
    act(() => jest.advanceTimersByTime(16));
    for (const strip of strips()) grown = Math.max(grown, (getAnimatedStyle(strip).height as number) ?? 0);
  }
  const g = deckGeometry(393, 873, 40, 24);
  expect(grown * (g.width / g.cardWidth)).toBeGreaterThan(36);
  expect(grown * (g.width / g.cardWidth)).toBeLessThanOrEqual(40.001);
  unmount(root);
});

test("the deck takes taps and a card's page takes over as soon as their springs are within Compose's settle point, about a third of a second, not Reanimated's 0.6", () => {
  withTabs(3);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  act(() => sendDeckCommand({ kind: "openFocused" }));
  let elapsed = 0;
  while (useBrowse.getState().surface === "deck" && elapsed < 1000) {
    act(() => jest.advanceTimersByTime(16));
    elapsed += 16;
  }
  expect(useBrowse.getState().surface).toBe("browsing");
  expect(elapsed).toBeLessThan(450);
  unmount(root);
});
