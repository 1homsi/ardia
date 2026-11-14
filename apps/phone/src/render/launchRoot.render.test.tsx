import { AppState } from "react-native";
import { act } from "react-test-renderer";
import { LaunchRoot } from "../dev/LaunchRoot";
import { renderSurface, textOf, unmount } from "../../test/render/harness";

const mockLaunch = { pageLab: false };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  return { ...actual, pages: { ...actual.pages, launchOptions: () => ({ pageLab: mockLaunch.pageLab, syncDemo: false, lab: true, arguments: {} }) } };
});
jest.mock("../App", () => ({ __esModule: true, default: () => require("react").createElement(require("react-native").Text, null, "the app") }));
jest.mock("../dev/PageLab", () => ({ PageLab: () => require("react").createElement(require("react-native").Text, null, "the lab") }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("a lab build's lab launch reaches a running app, even one held on the import failure screen", () => {
  const root = renderSurface(<LaunchRoot />);
  act(() => jest.advanceTimersByTime(100));
  expect(textOf(root)).toContain("the app");
  mockLaunch.pageLab = true;
  const listeners = (AppState.addEventListener as unknown as jest.Mock).mock?.calls ?? [];
  act(() => listeners.forEach(([event, listener]: [string, (state: string) => void]) => event === "change" && listener("active")));
  expect(textOf(root)).toContain("the lab");
  unmount(root);
});

