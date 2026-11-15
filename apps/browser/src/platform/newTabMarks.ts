export type NewTabBarStage = "page" | "committed" | "focused" | "rest";

export type MarkNewTabBar = (stage: NewTabBarStage, tabId: string) => void;

export const markNewTabBar: MarkNewTabBar = () => {};
