import { Platform, StyleSheet } from "react-native";
import { act } from "react-test-renderer";
import { BottomBar } from "../components/browsing/BottomBar";
import { BrowsingScreen } from "../components/browsing/BrowsingScreen";
import { barAddress, FloatingBar } from "../components/browsing/FloatingBar";
import { appDesign, DesignProvider, Symbol } from "../components/ui";
import { storeTone, usePages } from "../state/pages/store";
import { DESIGNS, designFor, type Design } from "../lib/design";
import * as pageActions from "../state/page/actions";
import { useBrowse } from "../state/browse/store";
import { currentTabs, useTabs } from "../state/tabs/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const safeArea = require("react-native-safe-area-context") as { useSafeAreaInsets: () => { top: number; bottom: number; left: number; right: number } };

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(3);
  usePages.setState({ tones: {}, lastTones: {} });
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

const pageViewModule = require("../../../../packages/phone/src/PageView") as typeof import("../../../../packages/phone/src/PageView");

test("in the redesign the page runs full screen under the bar, told the top safe area and the bar's 75 points as obscured insets, and only the bar's pieces take touches", () => {
  jest.spyOn(pageViewModule, "pageObscuresInsets").mockImplementation(() => true);
  const root = page("redesigned");
  const view = root.root.findAll((node) => node.props.pageId !== undefined && node.props.obscuredInsets !== undefined)[0]!;
  expect(view.props.obscuredInsets).toEqual({ top: 47, bottom: 75 });
  expect(view.props.toneInsets).toEqual({ top: 0, bottom: 75 });
  expect(StyleSheet.flatten(host(root, "pageArea")!.props.style).marginBottom).toBe(0);
  expect(host(root, "pageStatusStrip")).toBeUndefined();
  let bar = host(root, "floatingBar")!.parent;
  while (bar && bar.props.pointerEvents === undefined) bar = bar.parent;
  expect(bar!.props.pointerEvents).toBe("box-none");
  unmount(root);
});

test("where the page view can't take obscured insets, and in the original design, the page stops above the bar as before", () => {
  jest.spyOn(pageViewModule, "pageObscuresInsets").mockImplementation(() => false);
  for (const design of DESIGNS) {
    const root = page(design);
    expect(root.root.findAll((node) => node.props.pageId !== undefined && node.props.obscuredInsets !== undefined)).toHaveLength(0);
    expect(host(root, "pageStatusStrip")).toBeDefined();
    expect(StyleSheet.flatten(host(root, "pageArea")!.props.style).marginBottom).toBeGreaterThan(0);
    unmount(root);
  }
});

test("the bar's glass and glyphs follow the page's sampled bottom colour, not the app's scheme or a private tab, and its glyphs are SF's sizes", () => {
  const tab = currentTabs().open[0]!;
  act(() => storeTone(tab.id, { top: "#FFFFFF", bottom: "#FFFFFF" }));
  const light = page("redesigned", { ...tab, isPrivate: true });
  expect(StyleSheet.flatten(host(light, "floatingBarTabs")!.props.style).backgroundColor).toBe("#FFFFFF");
  const symbols = light.root.findAll((node) => node.type === Symbol);
  expect(symbols.find((node) => node.props.name === "ellipsis")!.props.size).toBeCloseTo(23.3);
  expect(symbols.find((node) => node.props.name === "plus")!.props.size).toBeCloseTo(23.6);
  expect(symbols.find((node) => node.props.name === "eyeglassesThin")!.props).toMatchObject({ size: 28, color: "rgba(0,0,0,0.5)" });
  unmount(light);
  act(() => storeTone(tab.id, { top: "#101418", bottom: "#101418" }));
  const dark = page("redesigned", tab);
  expect(StyleSheet.flatten(host(dark, "floatingBarTabs")!.props.style).backgroundColor).toBe("#000000");
  unmount(dark);
});

test("before a page has reported a colour, the redesigned bar takes the app's own light or dark, as SwiftUI's barScheme does", () => {
  const tab = { ...currentTabs().open[0]!, themeColorHex: null };
  for (const scheme of ["light", "dark"] as const) {
    const spy = jest.spyOn(require("react-native"), "useColorScheme").mockReturnValue(scheme);
    const root = page("redesigned", tab);
    expect(StyleSheet.flatten(host(root, "floatingBarTabs")!.props.style).backgroundColor).toBe(scheme === "dark" ? "#000000" : "#FFFFFF");
    unmount(root);
    spy.mockRestore();
  }
});

test("the page view is given the profile's surface for what shows behind a swipe to navigate, as Compose's look.surface", () => {
  const root = page("original");
  const view = root.root.findAll((node) => node.props.pageId !== undefined && node.props.surfaceColor !== undefined)[0]!;
  const screen = root.root.findAll((node) => (node.type as { name?: string })?.name === "BrowsingScreen")[0]!;
  const surface = StyleSheet.flatten(screen.findAll((node) => typeof node.type === "string")[0]!.props.style).backgroundColor;
  expect(view.props.surfaceColor).toBe(surface);
  unmount(root);
});
