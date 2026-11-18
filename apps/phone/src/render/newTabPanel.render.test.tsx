import { Platform, ScrollView, StyleSheet } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { newTabPanelShown, NEW_TAB_FIELD, SearchTray } from "../components/search/SearchTray";
import { DesignProvider } from "../components/ui";
import * as browse from "../state/browse/store";
import { history } from "../state/history/store";
import { dismissSearch, presentSearch, searchState, typeSearch } from "../state/search/store";
import { useStageBar } from "../state/search/stageBar";
import { currentTabs, useTabs } from "../state/tabs/store";
import * as telemetry from "../state/telemetry/telemetry";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const mockFaceTaken = { then: (taken: () => void) => taken() };
const mockStage = { present: jest.fn(() => mockFaceTaken), holdLift: jest.fn(), releaseLift: jest.fn(), close: jest.fn(), finish: jest.fn() };
const mockSeen: { props: Record<string, unknown> | null } = { props: null };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  const React = jest.requireActual<typeof import("react")>("react");
  const native = jest.requireActual<typeof import("react-native")>("react-native");
  const onIPhone = () => native.Platform.OS === "ios";
  const SearchStage = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => mockStage, []);
    mockSeen.props = props;
    const { onLift, onReveal, onSettled, morphLook, anchorNativeId, faceNativeId, commandTop, fieldCenter, shown, ...rest } = props;
    return React.createElement(native.View, rest);
  });
  const CompletingField = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: () => undefined, blur: () => undefined, setText: () => undefined }), []);
    return React.createElement(native.View, { testID: "completingField", style: props.style, fieldNativeID: props.nativeID } as object);
  });
  return { ...actual, searchStageIsNative: onIPhone, SearchStage, SearchStagePanel: (props: object) => React.createElement(native.View, props), completingFieldIsNative: onIPhone, CompletingField };
});

const onIPhone = Platform.OS === "ios" ? test : test.skip;
const onAndroid = Platform.OS === "android" ? test : test.skip;
const PAGE_TRAY = 274;
let revision = 9000;

beforeEach(() => {
  jest.useFakeTimers();
  revision += 1;
  jest.spyOn(history(), "summary").mockImplementation(() =>
    Array.from({ length: 12 }, (_unused, index) => ({ url: `https://site${index}.example/`, title: `Site ${index}`, favicon: null, visits: 12 - index, lastVisit: index })),
  );
  jest.spyOn(history(), "revision").mockImplementation(() => revision);
  withTabs(2);
  useStageBar.setState({ onScreen: false, presented: false, morphs: false, landed: false, pills: 0 });
  act(() => browse.useBrowse.setState({ surface: "start", sheet: null }));
  Object.values(mockStage).forEach((call) => call.mockClear());
});

afterEach(() => {
  act(() => dismissSearch());
  act(() => jest.runOnlyPendingTimers());
  act(() => useTabs.setState({ incognito: false }));
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;
const host = (root: Root, id: string) => root.root.findAll((node) => node.props.testID === id && typeof node.type === "string")[0];
const flat = (node: ReactTestInstance | undefined) => StyleSheet.flatten(node?.props.style) ?? {};
const tray = () => renderSurface(<DesignProvider design="redesigned"><SearchTray /></DesignProvider>);
const lift = (to: number) => act(() => (mockSeen.props!.onLift as (lift: { lift: number; up: boolean }) => void)({ lift: to, up: true }));
const editPage = () => act(() => presentSearch("page", "site0.example", null, { currentUrl: "https://site0.example/", currentTabId: currentTabs().open[0]!.id }));

onIPhone("on a new tab the search panel runs from under the status bar down to the keyboard, while editing a page's address keeps today's panel", () => {
  act(() => presentSearch("start", ""));
  const root = tray();
  lift(300);
  const panel = flat(host(root, "traySurface")).height as number;
  expect(panel).toBeGreaterThan(PAGE_TRAY);
  unmount(root);
  act(() => dismissSearch());
  editPage();
  const edit = tray();
  lift(300);
  expect(flat(host(edit, "traySurface")).height).toBe(PAGE_TRAY);
  unmount(edit);
});

onIPhone("the new-tab panel's field is the large Search field with the mic inside, and Incognito sits beside it in the panel, outside the field", () => {
  act(() => presentSearch("start", ""));
  const root = tray();
  const row = host(root, "newTabFieldRow")!;
  expect(flat(row)).toMatchObject({ flexDirection: "row" });
  const capsule = host(root, "trayFieldCapsule")!;
  expect(flat(capsule).minHeight).toBe(NEW_TAB_FIELD.height);
  expect(flat(host(root, "completingField")).fontSize).toBe(NEW_TAB_FIELD.fontSize);
  const incognito = host(root, "newTabIncognito")!;
  expect(incognito.props.accessibilityLabel).toBe("Activate Incognito");
  expect(capsule.findAll((node) => node.props.accessibilityLabel === "Activate Incognito")).toHaveLength(0);
  expect(flat(incognito)).toMatchObject({ width: NEW_TAB_FIELD.incognito, height: NEW_TAB_FIELD.incognito });
  unmount(root);
});

onIPhone("more suggestions than fit scroll inside the panel under a field that stays put, and dragging the list keeps the keyboard, as today's tray does", () => {
  act(() => presentSearch("start", ""));
  const root = tray();
  act(() => typeSearch("site"));
  act(() => jest.advanceTimersByTime(50));
  const list = root.root.findAll((node) => node.type === ScrollView && node.props.testID === "newTabRowsScroll")[0]!;
  expect(list.props.keyboardDismissMode).toBe("none");
  expect(host(root, "trayRows")).toBeUndefined();
  expect(searchState().rows.length).toBeGreaterThan(3);
  unmount(root);
});

onIPhone("editing a page's address keeps today's field, with Incognito inside it, and today's rows", () => {
  editPage();
  const root = tray();
  expect(host(root, "newTabFieldRow")).toBeUndefined();
  expect(host(root, "newTabIncognito")).toBeUndefined();
  expect(host(root, "trayFieldCapsule")!.findAll((node) => node.props.accessibilityLabel === "Activate Incognito").length).toBeGreaterThan(0);
  act(() => typeSearch("site"));
  act(() => jest.advanceTimersByTime(50));
  expect(host(root, "newTabRowsScroll")).toBeUndefined();
  unmount(root);
});

onIPhone("the new-tab panel opening counts new_tab_search_opened, except in Incognito and when editing a page", () => {
  const counted = jest.spyOn(telemetry, "countUsage");
  act(() => presentSearch("start", ""));
  const root = tray();
  expect(counted).toHaveBeenCalledWith("new_tab_search_opened");
  unmount(root);
  act(() => dismissSearch());
  counted.mockClear();
  editPage();
  const edit = tray();
  expect(counted).not.toHaveBeenCalledWith("new_tab_search_opened");
  unmount(edit);
});

test("the panel shows on a phone for a search that isn't editing a page, and never beside a command bar", () => {
  expect(newTabPanelShown(false, true, false)).toBe(true);
  expect(newTabPanelShown(true, true, false)).toBe(false);
  expect(newTabPanelShown(false, false, false)).toBe(false);
  expect(newTabPanelShown(false, true, true)).toBe(false);
});

onAndroid("Android's search keeps its own tray: no new-tab panel", () => {
  act(() => presentSearch("start", ""));
  const root = tray();
  expect(host(root, "newTabFieldRow")).toBeUndefined();
  expect(host(root, "traySurface")).toBeUndefined();
  unmount(root);
});
