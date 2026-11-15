import type { WindowsNative } from "@ardia/shell";
import { engineAvailable, hostCall } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const EDGE_KEY = "self-check-top-edge";
const EDGE_URL = "data:text/html,<title>top edge</title><p>a page that reaches the window's top edge</p>";
const PLACE = { unit: "px", x: 0, y: 0, width: 400, height: 200 };

type Hit = { hit?: unknown; width?: unknown };

const firstWindow = async () => {
  const ids = await requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows").windowIds();
  expectTrue(ids.length > 0, "no window is open to host a page");
  return ids[0]!;
};

const hitAt = (x: number, y: number) => hostCall<Hit>("tab.hitTest", { key: EDGE_KEY, x, y });

const topEdgeChecks: Check[] = [
  {
    name: "engine: a page that reaches the window's top edge answers the top resize band as the window's top edge and its corner, and stays the page below it",
    async run() {
      const windowId = await firstWindow();
      await hostCall("tab.create", { key: EDGE_KEY, url: EDGE_URL, profile: "" }, windowId);
      try {
        await hostCall("tab.show", { key: EDGE_KEY, visible: true, ...PLACE }, windowId);
        const middle = await hitAt(150, 1);
        const width = typeof middle.width === "number" ? middle.width : 0;
        expectTrue(width > 0, `tab.hitTest said ${JSON.stringify(middle)}`);
        const hits = {
          middleOfTheTopEdge: middle.hit,
          windowCorner: (await hitAt(1, 1)).hit,
          pageEndAwayFromTheWindowCorner: (await hitAt(width - 2, 1)).hit,
          belowTheBand: (await hitAt(150, 40)).hit,
        };
        expectEqual(hits, { middleOfTheTopEdge: "top", windowCorner: "topLeft", pageEndAwayFromTheWindowCorner: "top", belowTheBand: "client" }, "the page window's hit test along the window's top edge");
      } finally {
        await hostCall("tab.close", { key: EDGE_KEY });
      }
    },
  },
];

export const checks: Check[] = engineAvailable() ? topEdgeChecks : [];
