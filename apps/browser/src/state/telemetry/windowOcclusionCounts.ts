import { chromeWindows, onWindowEvent } from "../../platform/windows";
import { consentToken, stillValid, type ConsentToken } from "./choice";

const SETTLE_MS = 1500;
const NONE = { focused_window_checks: 0, focused_window_pages_occluded: 0 };
let counts = { ...NONE };
let settling: ReturnType<typeof setTimeout> | null = null;

async function checkFocusedWindowOcclusion(token: ConsentToken) {
  const key = (await chromeWindows().catch(() => [])).find((w) => w.key && w.visible);
  if (!key || !stillValid(token)) return;
  counts.focused_window_checks++;
  if (key.chromeOccluded === true && key.occlusionVisible) counts.focused_window_pages_occluded++;
}

onWindowEvent((e) => {
  if (e.type !== "focus") return;
  if (settling) clearTimeout(settling);
  settling = null;
  const token = consentToken();
  if (token === null) return;
  settling = setTimeout(() => {
    settling = null;
    if (stillValid(token)) void checkFocusedWindowOcclusion(token);
  }, SETTLE_MS);
});

export function takeWindowOcclusionCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
