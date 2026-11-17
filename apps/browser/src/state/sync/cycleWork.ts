import { isSharing, useTelemetry } from "../telemetry/choice";
import { beginActivity } from "../app/jobActivity";

const NO_CYCLES = { cycles: 0, ms: 0, longestMs: 0 };
let work = NO_CYCLES;
let consentGeneration = 0;

useTelemetry.subscribe((current, previous) => {
  if (current.sharing === previous.sharing) return;
  consentGeneration++;
  work = NO_CYCLES;
});

export function timedCycle(startedAt: number, cycle: Promise<void>): Promise<void> {
  const done = beginActivity("sync", startedAt);
  void cycle.then(done, done);
  if (!isSharing()) return cycle;
  const generation = consentGeneration;
  return cycle.finally(() => {
    if (generation !== consentGeneration || !isSharing()) return;
    const ms = Date.now() - startedAt;
    work = { cycles: work.cycles + 1, ms: work.ms + ms, longestMs: Math.max(work.longestMs, ms) };
  });
}

export function takeCycleWork() {
  const taken = work;
  work = NO_CYCLES;
  return taken;
}
