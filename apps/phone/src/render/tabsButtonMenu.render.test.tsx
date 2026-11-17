import { Platform } from "react-native";
import { act } from "react-test-renderer";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";
import { idOf, resetNativeMenus, titles, type NativeItem } from "./nativeMenusMock";

jest.mock("@ardia/phone-native", () => require("./nativeMenusMock").nativeMenusModule(jest.requireActual("@ardia/phone-native")));

const { BottomBar } = require("../components/browsing/BottomBar") as typeof import("../components/browsing/BottomBar");
const { FloatingBar } = require("../components/browsing/FloatingBar") as typeof import("../components/browsing/FloatingBar");
const { tabsMenuItems } = require("../components/browsing/tabsMenu") as typeof import("../components/browsing/tabsMenu");
const { rolesFor } = require("../components/ui") as typeof import("../components/ui");
const tabMenus = require("../state/browse/tabMenus") as typeof import("../state/browse/tabMenus");
const { currentTabs } = require("../state/tabs/store") as typeof import("../state/tabs/store");
const { deckOrder } = require("../state/tabs/tabsState") as typeof import("../state/tabs/tabsState");

type Root = ReturnType<typeof renderSurface>;

const onIos = Platform.OS === "ios" ? test : test.skip;

beforeEach(() => {
  jest.useFakeTimers();
  resetNativeMenus();
  withTabs(4);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const order = () => deckOrder(currentTabs());
const contextMenus = (root: Root) => root.root.findAll((node) => node.type === ("ContextMenuView" as never));
const address = (root: Root) => root.root.findAll((node) => node.props.accessibilityLabel === "Address" && typeof node.props.onPress === "function")[0]!;
const label = (item: ReturnType<typeof tabsMenuItems>[number]) => (item === "divider" ? "divider" : "label" in item ? item.label : item.heading);

function floatingBar(calls: string[]) {
  const tabs = order();
  return renderSurface(
    <FloatingBar tab={tabs[tabs.length - 1]!} order={tabs} dark={false} showsPlus onTabs={() => calls.push("tabs")} onTabsMenu={() => calls.push("menu")} onStep={(delta) => calls.push(delta < 0 ? "previous" : "next")} onAddress={() => calls.push("address")} onPlus={() => undefined} onMore={() => undefined} />,
  );
}

test("the tabs menu is main's: the other tabs newest first, a divider, then Close Tab with its xmark, destructive", () => {
  const tabs = order();
  const items = tabsMenuItems(tabs);
  const others = tabs.slice(0, -1).reverse();
  expect(items.map(label)).toEqual([...others.map((tab) => tab.title), "divider", "Close Tab"]);
  expect(items[items.length - 1]).toEqual(expect.objectContaining({ systemImage: "xmark", destructive: true }));
  expect(tabsMenuItems(tabs.slice(-1)).map(label)).toEqual(["Close Tab"]);
});

test("where the bar has no tabs button, the menu starts with Show Tabs, as main's RecentTabsMenu, and keeps its divider before Close Tab even with no other tab", () => {
  const tabs = order();
  const shown: string[] = [];
  const items = tabsMenuItems(tabs, () => shown.push("tabs"));
  expect(items.map(label)).toEqual(["Show Tabs", ...tabs.slice(0, -1).reverse().map((tab) => tab.title), "divider", "Close Tab"]);
  expect(items[0]).toEqual(expect.objectContaining({ systemImage: "square.on.square" }));
  act(() => (items[0] as { onPress: () => void }).onPress());
  expect(shown).toEqual(["tabs"]);
  expect(tabsMenuItems(tabs.slice(-1), () => undefined).map(label)).toEqual(["Show Tabs", "divider", "Close Tab"]);
});

test("the floating bar has no tabs button: the address capsule takes its place", () => {
  const root = floatingBar([]);
  expect(root.root.findAll((node) => node.props.accessibilityLabel === "Tabs")).toHaveLength(0);
  expect(root.root.findAll((node) => node.props.testID === "floatingBarTabs")).toHaveLength(0);
  expect(root.root.findAll((node) => node.props.testID === "floatingBarLeading")).toHaveLength(0);
  unmount(root);
});

onIos("with the system's menus, touching and holding the address capsule is a UIKit menu of Show Tabs, the recent tabs and Close Tab, and VoiceOver gets Show Tabs, Recent Tabs, Previous Tab and Next Tab on the address", () => {
  resetNativeMenus(true);
  const switched = jest.spyOn(tabMenus, "switchToTab").mockImplementation(() => undefined);
  const closed = jest.spyOn(tabMenus, "closeFrontTab").mockImplementation(() => undefined);
  const calls: string[] = [];
  const root = floatingBar(calls);
  expect(contextMenus(root).filter((node) => node.props.testID === "tabsButtonMenu")).toHaveLength(0);
  const menu = contextMenus(root).find((node) => node.props.testID === "addressTabsMenu")!;
  expect(menu.props.trigger).toBe("longPress");
  const tabs = order();
  const others = tabs.slice(0, -1).reverse();
  expect(titles(menu.props.items as NativeItem[])).toEqual(["Show Tabs", ...others.map((tab) => tab.title), { "": ["Close Tab"] }]);
  act(() => menu.props.onSelect(idOf(menu.props.items, "Show Tabs")));
  act(() => menu.props.onSelect(idOf(menu.props.items, others[1]!.title)));
  expect(switched).toHaveBeenCalledWith(others[1]!.id);
  act(() => menu.props.onSelect(idOf(menu.props.items, "Close Tab")));
  expect(closed).toHaveBeenCalledTimes(1);
  const field = address(root);
  expect(field.props.onLongPress).toBeUndefined();
  expect(field.props.accessibilityHint).toBe("Opens search with this page’s address. Swipe up on the bar for your tabs.");
  expect(field.props.accessibilityActions).toEqual([{ name: "Show Tabs" }, { name: "Recent Tabs" }, { name: "Previous Tab" }, { name: "Next Tab" }]);
  for (const name of ["Show Tabs", "Recent Tabs", "Previous Tab", "Next Tab"]) act(() => field.props.onAccessibilityAction({ nativeEvent: { actionName: name } }));
  act(() => field.props.onPress());
  expect(calls).toEqual(["tabs", "tabs", "menu", "previous", "next", "address"]);
  unmount(root);
});

onIos("the classic bar's tabs button gets the same native menu", () => {
  resetNativeMenus(true);
  const root = renderSurface(<BottomBar order={order()} roles={rolesFor(false)} showsPlus onTabs={() => undefined} onTabsMenu={() => undefined} onStep={() => undefined} onPlus={() => undefined} onMore={() => undefined} />);
  expect(contextMenus(root).filter((node) => node.props.testID === "tabsButtonMenu")).toHaveLength(1);
  unmount(root);
});

test("without the system's menus a long press on the address opens the drawn tabs menu", () => {
  const calls: string[] = [];
  const root = floatingBar(calls);
  expect(contextMenus(root)).toHaveLength(0);
  act(() => address(root).props.onLongPress());
  expect(calls).toEqual(["menu"]);
  unmount(root);
});
