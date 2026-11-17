import { takeInputSourceKeys } from "../../platform/focus";

export function takeInputSourceKeyCounts(): { input_source_keys_webkit?: number } {
  const n = takeInputSourceKeys();
  return Number.isSafeInteger(n) && n > 0 ? { input_source_keys_webkit: n } : {};
}
