import { takeChromeSettingsOpens } from "./chromeSettingsOpens";
import { takePreloadPagesCounts } from "./preloadPagesCounts";
import { takeHiddenElementCounts } from "./hiddenElementCounts";
import { takeMinimalismCounts } from "./minimalismCounts";
import { takePageFocusReturns } from "./pageFocusReturns";
import { takeReaderCounts } from "./readerCounts";
import { takeWindowOcclusionCounts } from "./windowOcclusionCounts";
import { takeBarLoadFocusCounts } from "./barLoadFocus";
import { takePageCursorCounts } from "./pageCursorCounts";

export function takeFocusFeatureCounts() {
  return { ...takeMinimalismCounts(), ...takeReaderCounts(), ...takeHiddenElementCounts(), ...takeChromeSettingsOpens(), ...takePreloadPagesCounts(), ...takeWindowOcclusionCounts(), ...takePageFocusReturns(), ...takeBarLoadFocusCounts(), ...takePageCursorCounts() };
}
