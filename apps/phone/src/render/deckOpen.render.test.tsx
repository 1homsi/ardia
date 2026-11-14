import { act } from "react-test-renderer";
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
