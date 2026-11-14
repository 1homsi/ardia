import { act } from "react-test-renderer";
import { SearchTray } from "../components/search/SearchTray";
import * as browse from "../state/browse/store";
import { presentSearch, useSearch } from "../state/search/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const mockField = { native: true, setText: [] as [string, boolean][], focused: 0 };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  const { forwardRef, useImperativeHandle, createElement } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const CompletingField = forwardRef(function CompletingField(props: Record<string, unknown>, ref: unknown) {
    useImperativeHandle(ref, () => ({
      focus: () => (mockField.focused += 1),
      blur: () => undefined,
      setText: (text: string, selectsAll: boolean) => mockField.setText.push([text, selectsAll]),
    }));
    return createElement(View, { ...props, testID: "completingField" });
  });
  return { ...actual, CompletingField, completingFieldIsNative: () => mockField.native };
});

function field(root: ReturnType<typeof renderSurface>) {
  return root.root.findAll((node) => node.props.testID === "completingField" && typeof node.props.onTypedChange === "function")[0];
}

function plainField(root: ReturnType<typeof renderSurface>) {
  return root.root.findAll((node) => node.type === "TextInput")[0];
}

function labels(root: ReturnType<typeof renderSurface>) {
  return root.root.findAll((node) => typeof node.props.accessibilityLabel === "string" && typeof node.props.onPress === "function").map((node) => node.props.accessibilityLabel as string);
}

let submit: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockField.native = true;
  mockField.setText = [];
  mockField.focused = 0;
  submit = jest.spyOn(browse, "submitSearch").mockImplementation(() => undefined);
  withTabs(1);
  browse.useBrowse.setState({ surface: "start" });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  submit.mockRestore();
  jest.useRealTimers();
});

test("where the native field exists the tray uses it, with today's placeholder, keyboard and label, and focuses it", () => {
  presentSearch("start", "");
  const root = renderSurface(<SearchTray />);
  const native = field(root);
  expect(native).toBeDefined();
  expect(plainField(root)).toBeUndefined();
  expect(native!.props).toMatchObject({ placeholder: "Search…", accessibilityLabel: "Search or Enter Address", keyboardType: "web-search", returnKeyType: "go", autoCorrect: false, autoCapitalize: "none" });
  expect(mockField.focused).toBeGreaterThan(0);
  unmount(root);
});

test("typing offers the omnibox's completion after the typed text, highlighted in the accent at 30%", () => {
  presentSearch("start", "");
  const root = renderSurface(<SearchTray />);
  act(() => field(root)!.props.onTypedChange("goo"));
  act(() => useSearch.setState({ completion: "gle.com", completedFor: "goo" }));
  expect(field(root)!.props.offer).toEqual({ query: "goo", completion: "google.com" });
  expect(field(root)!.props.highlightColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
  act(() => useSearch.setState({ completion: "gle.com", completedFor: "go" }));
  expect(field(root)!.props.offer).toBeNull();
  unmount(root);
});

test("Go submits what the field shows, completion included", () => {
  presentSearch("start", "");
  const root = renderSurface(<SearchTray />);
  act(() => field(root)!.props.onSubmit("google.com"));
  expect(submit).toHaveBeenCalledWith("google.com");
  unmount(root);
});

test("opening the tray on a page's address selects all of it", () => {
  presentSearch("page", "https://example.com/otters");
  const root = renderSurface(<SearchTray />);
  expect(mockField.setText).toEqual([["https://example.com/otters", true]]);
  unmount(root);
});

test("the incognito toggle sits beside the field, and Clear Text replaces the mic once there is text", () => {
  presentSearch("start", "");
  const root = renderSurface(<SearchTray />);
  expect(labels(root).some((label) => /Incognito/.test(label))).toBe(true);
  expect(labels(root)).not.toContain("Clear Text");
  act(() => field(root)!.props.onTypedChange("otters"));
  expect(labels(root)).toContain("Clear Text");
  expect(labels(root)).not.toContain("Voice Search");
  unmount(root);
});

test("where the native field doesn't exist the tray keeps today's input, and it types and submits the same way", () => {
  mockField.native = false;
  presentSearch("start", "");
  const root = renderSurface(<SearchTray />);
  expect(field(root)).toBeUndefined();
  const plain = plainField(root)!;
  expect(plain.props).toMatchObject({ placeholder: "Search…", accessibilityLabel: "Search or Enter Address", keyboardType: "web-search", returnKeyType: "go" });
  act(() => plain.props.onChangeText("otters"));
  act(() => jest.advanceTimersByTime(50));
  expect(useSearch.getState().text).toBe("otters");
  act(() => plain.props.onSubmitEditing({ nativeEvent: { text: "otters" } }));
  expect(submit).toHaveBeenCalledWith("otters");
  unmount(root);
});
