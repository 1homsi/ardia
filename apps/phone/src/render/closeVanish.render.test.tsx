import { Platform } from "react-native";
import { getAnimatedStyle } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { TabDeck } from "../components/tabs/TabDeck";
import * as browse from "../state/browse/store";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

let closing: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_790_000_000_000 + 60_000);
  withTabs(3);
  browse.useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  closing = jest.spyOn(browse, "closeTabFromDeck").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  closing.mockRestore();
  jest.useRealTimers();
});

test("a closing card leaves with its puff: gone by half its fly-away instead of fading as a hard-edged ghost to the end, and softened on Android as the puff is", () => {
  const root = renderSurface(<TabDeck />);
  const cards = () => root.root.findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string");
  act(() => sendDeckCommand({ kind: "closeFocused" }));
  let blurred = 0;
  let faded = Infinity;
  for (let frame = 0; frame < 6; frame++) {
    act(() => jest.advanceTimersByTime(16));
    for (const card of cards()) {
      const style = getAnimatedStyle(card) as { opacity?: number; filter?: { blur?: number }[] };
      const blur = style.filter?.[0]?.blur ?? 0;
      if (blur > 0 || (style.opacity ?? 1) < 1) faded = Math.min(faded, style.opacity ?? 1);
      blurred = Math.max(blurred, blur);
    }
  }
  expect(faded).toBe(0);
  if (Platform.OS === "android") expect(blurred).toBeGreaterThan(2);
  else expect(blurred).toBe(0);
  unmount(root);
});
