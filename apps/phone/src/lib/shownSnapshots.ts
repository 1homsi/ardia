const shown = new Set<string>();

export const snapshotWasShown = (uri: string) => shown.has(uri);

export function noteSnapshotShown(uri: string) {
  shown.add(uri);
}
