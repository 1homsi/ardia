import { takeChromeSettingsOpens } from "./chromeSettingsOpens";
import { takeHiddenElementCounts } from "./hiddenElementCounts";
import { takeMinimalismCounts } from "./minimalismCounts";
import { takePageFocusReturns } from "./pageFocusReturns";
import { takeReaderCounts } from "./readerCounts";
import { takeWindowOcclusionCounts } from "./windowOcclusionCounts";
import { takeBarLoadFocusCounts } from "./barLoadFocus";
import { takePageCursorCounts } from "./pageCursorCounts";
import { takePictureInPictureCloseCounts } from "./pictureInPictureCloses";

export function takeFocusFeatureCounts() {
  return { ...takeMinimalismCounts(), ...takeReaderCounts(), ...takeHiddenElementCounts(), ...takeChromeSettingsOpens(), ...takeWindowOcclusionCounts(), ...takePageFocusReturns(), ...takeBarLoadFocusCounts(), ...takePageCursorCounts(), ...takePictureInPictureCloseCounts() };
}
