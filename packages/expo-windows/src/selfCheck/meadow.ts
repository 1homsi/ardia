import type { AppNative, WindowsNative } from "@ardia/shell";
import { hostCall } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectTrue, type Check } from "./check";

const PROBE_KEY = "self-check-webgl-probe";
const PROBE_URL = "data:text/html,<title>webgl probe</title>";
const PROBE_CODE = `const canvas = document.createElement("canvas"); const gl = canvas.getContext("webgl2"); let renderer = ""; if (gl) { const info = gl.getExtension("WEBGL_debug_renderer_info"); renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)); } post("result", JSON.stringify({ webgl2: !!gl, renderer }));`;
const PROBE_TRIES = 40;
const PROBE_WAIT_MS = 250;

type Probe = { webgl2: boolean; renderer: string };

const launchTest = () => requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().test;
const windows = () => requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows");
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function probe(windowId: string): Promise<Probe | null> {
  for (let tries = 0; tries < PROBE_TRIES; tries++) {
    const reply = await hostCall<{ result?: unknown }>("tab.call", { key: PROBE_KEY, method: "evaluate", code: PROBE_CODE }, windowId).catch(() => null);
    if (typeof reply?.result === "string") return JSON.parse(reply.result) as Probe;
    await pause(PROBE_WAIT_MS);
  }
  return null;
}

export const checks: Check[] = [
  {
    name: "meadow: an engine page reports whether it has WebGL2, and on which renderer",
    async run() {
      const ids = await windows().windowIds();
      expectTrue(ids.length > 0, "no window is open to host a page");
      const windowId = ids[0]!;
      await hostCall("tab.create", { key: PROBE_KEY, url: PROBE_URL, profile: "" }, windowId);
      try {
        const found = await probe(windowId);
        console.info(`[ardia windows] webgl2 probe: ${found ? `webgl2 ${found.webgl2 ? "available" : "unavailable"}, renderer "${found.renderer}"` : "no answer"}`);
        if (launchTest().meadowWebGL === "required") expectTrue(found?.webgl2, `no WebGL2 in an engine page (${JSON.stringify(found)})`);
      } finally {
        await hostCall("tab.close", { key: PROBE_KEY }).catch(() => undefined);
      }
    },
  },
];
