import { requireNativeModule } from "expo-modules-core";
import type { FollowKeyboard, KeptFollows } from "./keyboardFollow";

export type { FollowKeyboard, KeptFollows } from "./keyboardFollow";

export const followKeyboard: FollowKeyboard | null = (tabId) => requireNativeModule<{ followKeyboard: FollowKeyboard }>("ArdiaTabs").followKeyboard(tabId);

export const takeKeptFollows = (): KeptFollows => requireNativeModule<{ takeKeptFollows(): KeptFollows }>("ArdiaTabs").takeKeptFollows();
