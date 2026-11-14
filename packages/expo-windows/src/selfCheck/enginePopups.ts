import { hostCall, onEngineTopic } from "../engine/host";
import { expectEqual, type Check } from "./check";

export const pagePopupCheck = (pageKey: string): Check => ({
  name: "engine: a pop-up a page opens with a click stays a tab of its window, sent to the app as a pop-up with the size it asked for and its opener, and no Chromium pop-up window opens",
  async run() {
    const popupName = "ardia-self-check-popup";
    const opened = new Promise<Record<string, unknown>>((resolve, reject) => {
      const watching = onEngineTopic("tab.opened", (event: Record<string, unknown>) => {
        if (event.opener !== pageKey) return;
        clearTimeout(deadline);
        watching.remove();
        resolve(event);
      });
      const deadline = setTimeout(() => {
        watching.remove();
        reject(new Error("no tab.opened from the page's pop-up within 10000 ms"));
      }, 10000);
    });
    const evaluate = async (code: string, userGesture = false) => {
      const reply = await hostCall<{ result?: unknown }>("tab.call", { key: pageKey, method: "evaluate", userGesture, code });
      return typeof reply.result === "string" ? (JSON.parse(reply.result) as unknown) : null;
    };
    try {
      const asked = await evaluate(`post("result", JSON.stringify(!!window.open("about:blank", "${popupName}", "width=420,height=360,left=200,top=150")));`, true);
      expectEqual(asked, true, "window.open with a click returns a window");
      const event = await opened;
      const popup = (event.popup ?? null) as Record<string, unknown> | null;
      expectEqual(
        { window: event.window, profile: event.profile, width: popup?.width, height: popup?.height, placed: typeof popup?.x === "number" && typeof popup?.y === "number" },
        { window: true, profile: "", width: 420, height: 360, placed: true },
        "the pop-up's tab.opened",
      );
      expectEqual((await hostCall<{ popupBrowsers?: unknown }>("host.info")).popupBrowsers, 0, "Chromium pop-up windows");
      const linked = await evaluate(
        `const w = window.open("", "${popupName}"); const linked = !!w && w.opener === window; if (w) w.close(); setTimeout(() => post("result", JSON.stringify({ linked, closed: !!w && w.closed })), 1500);`,
      );
      expectEqual(linked, { linked: true, closed: true }, "the pop-up's opener, and window.close() from its opener");
    } finally {
      await evaluate(`const w = window.open("", "${popupName}"); if (w) w.close(); post("result", "null");`).catch(() => null);
    }
  },
});
