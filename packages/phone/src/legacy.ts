import { requireOptionalNativeModule } from "expo-modules-core";

export type LegacyTab = {
  id: string;
  url: string;
  title: string;
  created: number;
  lastActive: number;
  position: number;
  origin: "typed" | "search" | "link" | "sync" | "share" | "sent";
  archivedAt?: number;
  profileSyncId?: string;
  savedState?: string;
  faviconUrl?: string;
  themeColor?: string;
  snapshotPath?: string;
  receivedKey?: string;
  receivedFromDevice?: string;
};

export type LegacyVisit = {
  url: string;
  title: string;
  visitedAt: number;
  transition: "typed" | "link" | "backForward" | "formSubmit" | "restored" | "other";
  profileSyncId?: string;
};

export type LegacyData = {
  version: 1;
  store: string | null;
  tabs: LegacyTab[];
  selectedTabId: string | null;
  archive: LegacyTab[];
  visits: LegacyVisit[];
  preferences: Record<string, unknown>;
};

export type LegacyCounts = { tabs: number; archive: number; visits: number };

export type LegacyUnusableReason = "schema" | "corrupt" | "locked" | "io";

export type LegacySource =
  | { kind: "none" }
  | { kind: "pending"; counts: LegacyCounts }
  | { kind: "done" }
  | { kind: "unusable"; reason: LegacyUnusableReason };

export type LegacyRead = {
  tabs: LegacyTab[];
  archive: LegacyTab[];
  selectedTabId: string | null;
  preferences: Record<string, string>;
};

export type LegacyVisitPage = { visits: (LegacyVisit & { id: number })[]; next: number | null };

export type LegacyReceipt = { version: 1; tabs: number; archive: number; visits: number; preferences: number };

type OldRead = (Omit<LegacyData, "store" | "selectedTabId"> & { store?: string; selectedTabId?: string }) | null;

type LegacyNative = {
  source?(): Promise<LegacySource>;
  readLegacy?(): Promise<LegacyRead>;
  readVisits?(afterId: number, limit: number): Promise<LegacyVisitPage>;
  applyNativeSettings?(): Promise<void>;
  markImportedWith?(receipt: LegacyReceipt): Promise<void>;
  available?(): Promise<boolean>;
  imported?(): Promise<boolean>;
  markImported?(): Promise<void>;
  read?(): Promise<OldRead>;
};

const native = requireOptionalNativeModule<LegacyNative>("ArdiaPhoneLegacy");

const usesSourceShape = () => typeof native?.source === "function";

let oldRead: Promise<OldRead> | null = null;

const readOld = (): Promise<OldRead> => (oldRead ??= native?.read ? native.read() : Promise.resolve(null));

const asPreferenceStrings = (values: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, String(value)]] : [],
    ),
  );

export const legacyImport = {
  source: async (): Promise<LegacySource> => {
    if (!native) return { kind: "none" };
    if (usesSourceShape()) return native.source!();
    if (native.imported && (await native.imported())) return { kind: "done" };
    if (!native.available || !(await native.available())) return { kind: "none" };
    const data = await readOld();
    if (!data) return { kind: "unusable", reason: "io" };
    return { kind: "pending", counts: { tabs: data.tabs.length, archive: data.archive.length, visits: data.visits.length } };
  },
  read: async (): Promise<LegacyRead> => {
    if (!native) throw new Error("there is no legacy data to read");
    if (usesSourceShape()) return native.readLegacy!();
    const data = await readOld();
    if (!data) throw new Error("the legacy data could not be read");
    return { tabs: data.tabs, archive: data.archive, selectedTabId: data.selectedTabId ?? null, preferences: asPreferenceStrings(data.preferences) };
  },
  readVisits: async (afterId: number, limit: number): Promise<LegacyVisitPage> => {
    if (!native) return { visits: [], next: null };
    if (usesSourceShape()) return native.readVisits!(afterId, limit);
    const data = await readOld();
    if (!data) throw new Error("the legacy data could not be read");
    const start = Math.max(0, afterId);
    const visits = data.visits.slice(start, start + limit).map((visit, index) => ({ ...visit, id: start + index + 1 }));
    const end = start + visits.length;
    return { visits, next: end < data.visits.length ? end : null };
  },
  applyNativeSettings: async (): Promise<void> => {
    if (usesSourceShape()) await native!.applyNativeSettings!();
  },
  markImported: async (receipt: LegacyReceipt): Promise<void> => {
    if (!native) return;
    if (usesSourceShape()) {
      await native.markImportedWith!(receipt);
      return;
    }
    await native.markImported?.();
  },
};

export const legacy = {
  available: async (): Promise<boolean> => {
    const source = await legacyImport.source();
    return source.kind === "pending";
  },
  imported: async (): Promise<boolean> => (await legacyImport.source()).kind !== "pending",
  markImported: async (): Promise<void> => {
    if (usesSourceShape()) throw new Error("use legacyImport.markImported(receipt) on this platform");
    await native?.markImported?.();
  },
  read: async (): Promise<LegacyData | null> => {
    if (usesSourceShape()) return null;
    const data = native ? await readOld() : null;
    return data ? { ...data, store: data.store ?? null, selectedTabId: data.selectedTabId ?? null } : null;
  },
};
