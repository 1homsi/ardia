import type { MarkNewTabBar } from "./newTabMarks";

export type { MarkNewTabBar, NewTabBarStage } from "./newTabMarks";

export const markNewTabBar: MarkNewTabBar = (stage, tabId) => console.info(`[ardia windows] new tab bar ${stage} ${tabId}`);
