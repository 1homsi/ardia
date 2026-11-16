import type { KeyHoldCounts, KeyHoldNative } from "@ardia/shell";
import { requireNativeModule } from "expo-modules-core";

export const takeKeyHoldCounts = (): KeyHoldCounts => requireNativeModule<KeyHoldNative>("ArdiaFocus").keyHoldCounts();
