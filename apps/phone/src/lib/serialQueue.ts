export function serialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (work: () => Promise<void> | void): Promise<void> => {
    const run = tail.then(work).catch(() => undefined);
    tail = run;
    return run;
  };
}
