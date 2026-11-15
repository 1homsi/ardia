import { Platform, StyleSheet } from "react-native";
import { act } from "react-test-renderer";
import { BottomBar } from "../components/browsing/BottomBar";
import { BrowsingScreen } from "../components/browsing/BrowsingScreen";
import { barAddress, FloatingBar } from "../components/browsing/FloatingBar";
import { appDesign, DesignProvider } from "../components/ui";
import { DESIGNS, designFor, type Design } from "../lib/design";
import * as pageActions from "../state/page/actions";
import { useBrowse } from "../state/browse/store";
import { currentTabs, useTabs } from "../state/tabs/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const safeArea = require("react-native-safe-area-context") as { useSafeAreaInsets: () => { top: number; bottom: number; left: number; right: number } };

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(3);
  useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  jest.spyOn(safeArea, "useSafeAreaInsets").mockImplementation(() => ({ top: 47, bottom: 34, left: 0, right: 0 }));
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const page = (design: Design, tab = currentTabs().open[0]!) =>
  renderSurface(
    <DesignProvider design={design}>
      <BrowsingScreen tab={tab} />
    </DesignProvider>,
  );

const host = (root: ReturnType<typeof renderSurface>, testID: string) => root.root.findAll((node) => node.props.testID === testID && typeof node.type === "string")[0];

test("the design is chosen in one place: the redesign on iPhone and the original on Android, and the app runs the one its phone gets", () => {
  expect(designFor("ios")).toBe("redesigned");
  expect(designFor("android")).toBe("original");
  expect(appDesign).toBe(designFor(Platform.OS));
});

test.each(DESIGNS)("the %s design draws its own page bar and only that one", (design) => {
  const root = page(design);
  expect(root.root.findAll((node) => node.type === FloatingBar)).toHaveLength(design === "redesigned" ? 1 : 0);
  expect(root.root.findAll((node) => node.type === BottomBar)).toHaveLength(design === "original" ? 1 : 0);
  unmount(root);
});

test("the redesigned bar is three glass pieces, 48 points tall, 8 apart and 12 in from the sides, their bottom 21.5 points above the screen's edge", () => {
  const root = page("redesigned");
  const row = StyleSheet.flatten(host(root, "floatingBar")!.props.style);
  expect(row).toMatchObject({ gap: 8, paddingHorizontal: 12, height: 48 });
  let place = host(root, "floatingBar")!.parent;
  while (place && (typeof place.type !== "string" || StyleSheet.flatten(place.props.style)?.bottom === undefined)) place = place.parent;
  expect(StyleSheet.flatten(place!.props.style).bottom).toBe(21.5);
  for (const piece of ["floatingBarTabs", "floatingBarPlus"]) expect(StyleSheet.flatten(host(root, piece)!.props.style)).toMatchObject({ width: 48, height: 48, borderRadius: 24 });
  expect(StyleSheet.flatten(host(root, "floatingBarAddress")!.props.style)).toMatchObject({ flex: 1, height: 48, borderRadius: 24 });
  unmount(root);
});

test("the address capsule shows the page's host, and a tap on it searches with the page's address while the dots open the page menu", () => {
  const edit = jest.spyOn(pageActions, "editPageQuery").mockImplementation(() => undefined);
  const menu = jest.spyOn(pageActions, "openPageMenu").mockImplementation(async () => undefined);
  const root = page("redesigned");
  expect(host(root, "floatingBarHost")!.props.children).toBe("site0.example");
  act(() => {
    root.root.findAll((node) => node.props.accessibilityLabel === "Address" && typeof node.props.onPress === "function")[0]!.props.onPress();
  });
  expect(edit).toHaveBeenCalledTimes(1);
  act(() => {
    root.root.findAll((node) => node.props.accessibilityLabel === "Page Menu" && typeof node.props.onPress === "function")[0]!.props.onPress();
  });
  expect(menu).toHaveBeenCalledTimes(1);
  unmount(root);
});

test("a page loaded over plain http reads Not Secure in place of its icon, as SwiftUI's bar does", () => {
  const tab = { ...currentTabs().open[0]!, url: "http://plain.example/" };
  useTabs.setState((state) => ({ open: state.open.map((t) => (t.id === tab.id ? tab : t)) }));
  expect(barAddress(tab)).toMatchObject({ host: "plain.example", insecure: true });
  const root = page("redesigned", tab);
  expect(host(root, "floatingBarNotSecure")).toBeDefined();
  expect(root.root.findAll((node) => node.props.accessibilityLabel === "Address, Not Secure")).not.toHaveLength(0);
  unmount(root);
});
