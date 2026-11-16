import type { MarkNewTabBar } from "./newTabMarks";
export type { MarkNewTabBar, NewTabBarStage } from "./newTabMarks";

const typedTabs = new Set<string>();

export const markNewTabBar: MarkNewTabBar = (stage, tabId) => {
  if (stage === "page") typedTabs.delete(tabId);
  if (stage === "typed") {
    if (typedTabs.has(tabId)) return;
    typedTabs.add(tabId);
  }
  console.info(`[ardia windows] new tab bar ${stage} ${tabId}`);
};
