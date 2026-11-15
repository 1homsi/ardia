export type FollowKeyboard = (tabId: string) => void;

export const followKeyboard: FollowKeyboard | null = null;

export type KeptFollows = { kept: number; used: number; dropped: number };

export const takeKeptFollows = (): KeptFollows => ({ kept: 0, used: 0, dropped: 0 });
