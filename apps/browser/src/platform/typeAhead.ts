export type TypeAheadSignal = (windowId: string) => void;

export const fieldTookFocus: TypeAheadSignal = () => {};

export const fieldWontTakeFocus: TypeAheadSignal = () => {};
