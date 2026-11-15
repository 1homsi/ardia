import { Platform } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { SettingsView } from "../components/settings/SettingsView";
import { openSettings, pushSettings, settingsNav } from "../state/settings/nav";
import { usePreferences } from "../state/settings/store";
import { PHONE_SHARING_COPY } from "../lib/telemetryCopy";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const onIos = Platform.OS === "ios" ? test : test.skip;

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(2);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

type Root = ReturnType<typeof renderSurface>;

const hosts = (root: Root, has: (props: Record<string, unknown>) => boolean) => root.root.findAll((node) => typeof node.type === "string" && has(node.props));
const stackOf = (root: Root) => hosts(root, (props) => Array.isArray(props.path))[0]!;
const titlesIn = (node: ReactTestInstance) => node.findAll((inner) => typeof inner.type === "string" && typeof inner.props.title === "string" && typeof inner.props.systemImage === "string").map((inner) => inner.props.title as string);
const toggleFor = (root: Root, title: string) => hosts(root, (props) => typeof props.isOn === "boolean").find((node) => titlesIn(node).includes(title))!;

onIos("on iPhone Settings is a native stack whose root lists main's rows in main's order, Default Browser when it's offered, and our usage-sharing rows before Show Onboarding", () => {
  openSettings();
  const root = renderSurface(<SettingsView />);
  const rows = titlesIn(stackOf(root));
  expect(rows).toEqual([
    "Appearance",
    "Site Settings",
    "Default Browser",
    "Search Engine",
    "Search Suggestions",
    "Auto-Open Keyboard",
    "Archive Inactive Tabs",
    "Open App Links In",
    "Clear Browsing Data",
    "Export Open Tabs",
    PHONE_SHARING_COPY.toggle,
    PHONE_SHARING_COPY.whatsSent,
    "Show Onboarding",
    "About Ardia",
  ]);
  const links = hosts(root, (props) => typeof props.value === "string" && !("path" in props)).map((node) => node.props.value);
  expect(links).toEqual(["sync", "appearance", "siteSettings", "defaultBrowser", "searchEngine", "clearData", "whatsSent", "about"]);
  unmount(root);
});

onIos("the native stack's path is the settings store's stack, so a push from any page slides in natively, and a native back pops the store", () => {
  openSettings();
  const root = renderSurface(<SettingsView />);
  expect(stackOf(root).props.path).toEqual([]);
  act(() => pushSettings({ page: "appearance" }));
  expect(stackOf(root).props.path).toEqual(["appearance"]);
  const destination = hosts(root, (props) => props.name === "destination" && (props.extraProps as { value?: string } | undefined)?.value === "appearance")[0]!;
  expect(destination.findAll((node) => typeof node.type === "string" && node.props.children === "Interface Style")).toHaveLength(1);
  expect(root.root.findAll((node) => node.props.testID === "settingsTitle")).toHaveLength(0);
  act(() => stackOf(root).props.onPathChange({ nativeEvent: { path: [] } }));
  expect(settingsNav().stack).toEqual([{ page: "root" }]);
  unmount(root);
});

onIos("a switch on the root writes its preference, and Done closes Settings", () => {
  openSettings();
  const root = renderSurface(<SettingsView />);
  const before = usePreferences.getState().searchSuggestions;
  act(() => toggleFor(root, "Search Suggestions").props.onIsOnChange({ nativeEvent: { isOn: !before } }));
  expect(usePreferences.getState().searchSuggestions).toBe(!before);
  const done = hosts(root, (props) => typeof props.onButtonPress === "function" || typeof props.onPress === "function").find((node) => node.findAll((inner) => inner.props.text === "Done" || inner.props.children === "Done").length > 0);
  expect(done).toBeDefined();
  act(() => (done!.props.onButtonPress ?? done!.props.onPress)({ nativeEvent: {} }));
  expect(settingsNav().open).toBe(false);
  unmount(root);
});
