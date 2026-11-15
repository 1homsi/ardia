import { Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import * as Reanimated from "react-native-reanimated";
import { act } from "react-test-renderer";
import { Sheet } from "../components/ui";
import { renderSurface, unmount } from "../../test/render/harness";

const mockMotion = { reduced: false };
jest.mock("../state/app/systemLook", () => ({ ...jest.requireActual("../state/app/systemLook"), useReduceMotion: () => mockMotion.reduced }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const SHEET_HEIGHT = 500;

function openSheet(onDismiss: () => void, onHidden: () => void = () => undefined, open = true) {
  const root = renderSurface(
    <Sheet open={open} onDismiss={onDismiss} onHidden={onHidden}>
      <Text>Menu</Text>
    </Sheet>,
  );
  const panel = root.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityViewIsModal === true)[0]!;
  act(() => panel.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: SHEET_HEIGHT } } }));
  return root;
}

function drag(translationY: number, velocityY: number) {
  act(() =>
    fireGestureHandler(getByGestureTestId("sheetDrag"), [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: translationY / 2, velocityY },
      { state: State.ACTIVE, translationY, velocityY },
      { state: State.END, translationY, velocityY },
    ]),
  );
  act(() => jest.runOnlyPendingTimers());
}

test("dragging the sheet down past 35% of its height, capped at 120 points, closes it, as Compose's tray drag", () => {
  const dismiss = jest.fn();
  const root = openSheet(dismiss);
  drag(130, 0);
  expect(dismiss).toHaveBeenCalledTimes(1);
  unmount(root);
});

test("a short slow drag springs back, and a flick past 800 points a second closes it however short", () => {
  const dismiss = jest.fn();
  const root = openSheet(dismiss);
  drag(40, 100);
  expect(dismiss).not.toHaveBeenCalled();
  drag(30, 900);
  expect(dismiss).toHaveBeenCalledTimes(1);
  unmount(root);
});

test("with Reduce Motion the sheet leaves on a short timing instead of its spring", () => {
  mockMotion.reduced = true;
  const timing = jest.spyOn(Reanimated, "withTiming");
  const spring = jest.spyOn(Reanimated, "withSpring");
  const root = renderSurface(
    <Sheet open={false} onDismiss={() => undefined} onHidden={() => undefined}>
      <Text>Menu</Text>
    </Sheet>,
  );
  expect(timing).toHaveBeenCalledWith(0, expect.objectContaining({ duration: 200 }), expect.any(Function));
  expect(spring.mock.calls.filter(([to]) => to === 0)).toHaveLength(0);
  unmount(root);
  mockMotion.reduced = false;
});
