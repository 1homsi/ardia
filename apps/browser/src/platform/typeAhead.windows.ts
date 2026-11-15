import { requireNativeModule } from "expo-modules-core";
import type { FieldTookFocus } from "./typeAhead";

export type { FieldTookFocus } from "./typeAhead";

type TypeAheadNative = { typeAheadReady(windowId: string): Promise<void> };

export const fieldTookFocus: FieldTookFocus = (windowId) => void requireNativeModule<TypeAheadNative>("ArdiaFocus").typeAheadReady(windowId).catch(() => {});
