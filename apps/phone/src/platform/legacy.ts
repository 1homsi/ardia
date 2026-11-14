import { legacyImport as native } from "@ardia/phone-native";
import type { LegacyApi } from "../state/legacy/importer";

type MaybeStartsFresh = { startFresh?: () => Promise<void> };

export const legacyImport: LegacyApi = {
  source: () => native.source(),
  read: () => native.read(),
  readVisits: (afterId, limit) => native.readVisits(afterId, limit),
  applyNativeSettings: () => native.applyNativeSettings(),
  markImported: (receipt) => native.markImported(receipt),
  startFresh: async () => {
    const open = (native as MaybeStartsFresh).startFresh;
    if (open) await open();
  },
};
