import { takeSidebarScrollCounts } from "./sidebarScrollCounts";
import { isSharing, useTelemetry } from "./choice";

let resizes = 0;
let pinnedCollapses = 0;
let pinnedExpands = 0;

useTelemetry.subscribe((current, previous) => {
  if (current.sharing === previous.sharing || current.sharing) return;
  pinnedCollapses = 0;
  pinnedExpands = 0;
});

export function notePinnedSectionToggled(collapsed: boolean) {
  if (!isSharing()) return;
  if (collapsed) pinnedCollapses++;
  else pinnedExpands++;
}

export function noteSidebarResize() {
  resizes++;
}

export function takeSidebarResizeCounts() {
  const taken = { sidebar_resizes: resizes, pinned_section_collapses: pinnedCollapses, pinned_section_expands: pinnedExpands, ...takeSidebarScrollCounts() };
  resizes = 0;
  pinnedCollapses = 0;
  pinnedExpands = 0;
  return taken;
}
