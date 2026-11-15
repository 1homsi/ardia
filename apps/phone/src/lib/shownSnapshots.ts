const shown = new Set<string>();

export const snapshotWasShown = (uri: string) => shown.has(uri);

export function noteSnapshotShown(uri: string) {
  shown.add(uri);
}

const paintWaiters = new Map<string, Set<(painted: boolean) => void>>();

export const pictureKey = (owner: string, uri: string) => `${owner}|${uri}`;

export function notePicturePainted(uri: string) {
  const waiters = paintWaiters.get(uri);
  paintWaiters.delete(uri);
  waiters?.forEach((then) => then(true));
}

export function whenPicturePainted(uri: string, capMs: number, then: (painted: boolean) => void): () => void {
  let called = false;
  const done = (painted: boolean) => {
    if (called) return;
    called = true;
    clearTimeout(cap);
    paintWaiters.get(uri)?.delete(done);
    then(painted);
  };
  const cap = setTimeout(() => done(false), capMs);
  const waiters = paintWaiters.get(uri) ?? new Set<(painted: boolean) => void>();
  waiters.add(done);
  paintWaiters.set(uri, waiters);
  return () => {
    called = true;
    clearTimeout(cap);
    paintWaiters.get(uri)?.delete(done);
  };
}

const pageTops = new Map<string, number>();

export function noteSnapshotPageTop(uri: string, top: number) {
  pageTops.set(uri, top);
}

export const snapshotPageTop = (uri: string): number | null => pageTops.get(uri) ?? null;
