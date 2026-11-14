export type RelayEntry = { mtime: number; size: number };
export type RelaySide = Record<string, RelayEntry>;
export type RelayRecord = Record<string, { mac?: RelayEntry; phone?: RelayEntry }>;
export type RelayStep = { kind: "toPhone" | "toMac" | "deleteOnMac" | "deleteOnPhone"; file: string };
export function plan(mac: RelaySide, phone: RelaySide, record: RelayRecord): RelayStep[];
export function nextRecord(record: RelayRecord, before: { mac: RelaySide; phone: RelaySide }, after: { mac: RelaySide; phone: RelaySide }, planned: RelayStep[], done: RelayStep[]): RelayRecord;
export function parseListing(out: string, options?: { withProbe?: boolean }): RelaySide;
export function quoted(text: string): string;
export function emptySide(before: { mac: RelaySide; phone: RelaySide }, record: RelayRecord): "mac" | "phone" | null;
