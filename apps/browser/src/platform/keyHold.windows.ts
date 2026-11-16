import { nativeModule, type KeyHoldCounts } from "@ardia/shell";

export const takeKeyHoldCounts = (): KeyHoldCounts => nativeModule("ArdiaFocus").keyHoldCounts?.() ?? { holds: 0, replayed: 0, drops: {} };
