import { StyleSheet } from "react-native";
import { act } from "react-test-renderer";
import { StartScreen } from "../components/search/StartScreen";
import { SearchTray } from "../components/search/SearchTray";
import { TabDeck } from "../components/tabs/TabDeck";
import { useTheme } from "../components/ui";
import { useBrowse } from "../state/browse/store";
import { presentSearch } from "../state/search/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const lookModule = require("../../../../packages/phone/src/look") as typeof import("../../../../packages/phone/src/look");

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(3);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;

let theme: ReturnType<typeof useTheme> | null = null;
function ThemeProbe() {
  theme = useTheme();
  return null;
}

const bases = (root: Root) => root.root.findAll((node) => node.props.testID === "backdropBase" && typeof node.type === "string").map((node) => StyleSheet.flatten(node.props.style).backgroundColor);

test("at launch, the tray over the start screen has the start backdrop's own colour under it even before the native backdrop draws its first frame", () => {
  jest.spyOn(lookModule, "lookIsNative").mockImplementation(() => true);
  useBrowse.setState({ surface: "start", sheet: null });
  presentSearch("home", "");
  const root = renderSurface(
    <>
      <ThemeProbe />
      <StartScreen />
      <SearchTray />
    </>,
  );
  expect(bases(root)).toEqual([theme!.start.colors[0]]);
  unmount(root);
});

test("the deck's native backdrop has the deck's base colour under it", () => {
  jest.spyOn(lookModule, "lookIsNative").mockImplementation(() => true);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(
    <>
      <ThemeProbe />
      <TabDeck />
    </>,
  );
  expect(bases(root)).toContain(theme!.backdrop[0]);
  unmount(root);
});

test("with the look's fallback the gradient is drawn by the app and needs no base", () => {
  useBrowse.setState({ surface: "start", sheet: null });
  const root = renderSurface(<StartScreen />);
  expect(bases(root)).toEqual([]);
  unmount(root);
});
