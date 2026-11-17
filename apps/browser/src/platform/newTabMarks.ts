export type NewTabBarStage = "page" | "committed" | "focused" | "rest" | "typed";

export type MarkNewTabBar = (stage: NewTabBarStage, tabId: string) => void;

export const markNewTabBar: MarkNewTabBar = () => {};
