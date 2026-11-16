import type { PictureInPictureDrag, PictureInPictureState } from "../../platform/media";
import type { PageEngine } from "../engines/engines";

export type PictureInPictureCloser = NonNullable<PictureInPictureState["closedBy"]>;

type CloseCounts = { auto: number; manual: number };

let nothingPlaying = 0;
const backToTab: Record<PageEngine, number> = { chromium: 0, webkit: 0 };
const closed: Record<PictureInPictureCloser, CloseCounts> = { app: { auto: 0, manual: 0 }, chrome: { auto: 0, manual: 0 } };
const noDrags = () => ({ moved: 0, offCursor: 0, slowMove: 0 });
let drags = noDrags();
const clickSkips = { back: 0, ahead: 0 };

export function noteAutoPictureInPictureNothingPlaying() {
  nothingPlaying++;
}

export function notePictureInPictureBackToTab(engine: PageEngine) {
  backToTab[engine]++;
}

export function notePictureInPictureClosed(closedBy: PictureInPictureCloser, auto: boolean) {
  closed[closedBy][auto ? "auto" : "manual"]++;
}

export function notePictureInPictureDragged({ offCursor, slowMove }: PictureInPictureDrag) {
  drags.moved++;
  if (offCursor) drags.offCursor++;
  if (slowMove) drags.slowMove++;
}

export function notePictureInPictureClickSkip(seconds: number) {
  if (seconds < 0) clickSkips.back++;
  else if (seconds > 0) clickSkips.ahead++;
}

export function takePictureInPictureCounts() {
  const taken = {
    nothingPlaying,
    backToTab: { ...backToTab },
    closed: { app: { ...closed.app }, chrome: { ...closed.chrome } },
    drags,
    clickSkips: { ...clickSkips },
  };
  nothingPlaying = 0;
  drags = noDrags();
  backToTab.chromium = 0;
  backToTab.webkit = 0;
  for (const by of Object.values(closed)) {
    by.auto = 0;
    by.manual = 0;
  }
  clickSkips.back = 0;
  clickSkips.ahead = 0;
  return taken;
}
