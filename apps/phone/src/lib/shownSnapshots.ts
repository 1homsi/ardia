const shown = new Set<string>();

export const snapshotWasShown = (uri: string) => shown.has(uri);

export function noteSnapshotShown(uri: string) {
  shown.add(uri);
}

const pageTops = new Map<string, number>();

export function noteSnapshotPageTop(uri: string, top: number) {
  pageTops.set(uri, top);
}

export const snapshotPageTop = (uri: string): number | null => pageTops.get(uri) ?? null;
