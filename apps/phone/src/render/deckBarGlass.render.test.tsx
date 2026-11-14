import { act } from "react-test-renderer";
import { DeckBar } from "../components/tabs/DeckBar";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const lookModule = require("../../../../packages/phone/src/look") as typeof import("../../../../packages/phone/src/look");

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const bar = () =>
  renderSurface(
    <DeckBar
      leading={{ icon: "archivebox", label: "Archive", onPress: () => undefined }}
      plusLabel="New Tab"
      frost={{ source: "deck", variant: "bar" }}
      onPlus={() => undefined}
      onPlusMenu={() => undefined}
      onSettings={() => undefined}
    />,
  );

const symbolSizes = (root: ReturnType<typeof renderSurface>) =>
  root.root.findAll((node) => typeof node.props.name === "string" && typeof node.props.size === "number" && typeof node.type !== "string").map((node) => node.props.size as number);

test("where the system glass exists, the deck bar's three buttons are glass (circle, capsule, circle) with SwiftUI's icon sizes, and the icons let touches through to the glass", () => {
  const glass = jest.spyOn(lookModule, "glassIsNative").mockImplementation(() => true);
  const root = bar();
  const shapes = root.root.findAll((node) => node.type === lookModule.Glass).map((node) => node.props.shape);
  expect(shapes).toEqual(["circle", "capsule", "circle"]);
  expect([...new Set(symbolSizes(root))].sort()).toEqual([15, 20]);
  const icons = root.root.findAll((node) => typeof node.props.name === "string" && typeof node.props.size === "number" && typeof node.type !== "string");
  for (const icon of icons) expect(icon.parent?.props.pointerEvents).toBe("none");
  glass.mockRestore();
  unmount(root);
});

test("without the system glass the bar keeps today's frost and icon sizes", () => {
  const glass = jest.spyOn(lookModule, "glassIsNative").mockImplementation(() => false);
  const root = bar();
  expect(root.root.findAll((node) => node.type === lookModule.Glass)).toHaveLength(0);
  expect([...new Set(symbolSizes(root))].sort()).toEqual([17, 22]);
  glass.mockRestore();
  unmount(root);
});
