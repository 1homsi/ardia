import { requireNativeModule } from "expo-modules-core";
import type { TypeAheadSignal } from "./typeAhead";

export type { TypeAheadSignal } from "./typeAhead";

type TypeAheadNative = { typeAheadReady(windowId: string): Promise<void>; typeAheadCancel(windowId: string): Promise<void> };

const native = () => requireNativeModule<TypeAheadNative>("ArdiaFocus");

export const fieldTookFocus: TypeAheadSignal = (windowId) => void native().typeAheadReady(windowId).catch(() => {});

export const fieldWontTakeFocus: TypeAheadSignal = (windowId) => void native().typeAheadCancel(windowId).catch(() => {});
