import { useEffect, useRef } from "react";
import { requireOptionalNativeModule } from "expo-modules-core";
import { createBudgetProbe, judge, mode, parseState, record, refresh, wantsMeasurement, type BudgetState, type FrameSample, type LookMode, type SystemLook } from "./lookBudgetRules";
import { labLog } from "./system";

type BudgetNative = {
  lookBudget?: () => { state: string | null; version: string; forced: string | null };
  setLookBudget?: (state: string) => void;
  forceLookBudget?: (applied: string | null) => void;
  sampleFrames?: (millis: number) => Promise<FrameSample | null>;
};

const native = requireOptionalNativeModule<BudgetNative>("ArdiaPhoneLook");

let current: BudgetState | null = null;
let appliedAtLaunch: "full" | "degraded" = "full";

function load(now = Date.now()): BudgetState | null {
  const stored = native?.lookBudget?.();
  if (!stored) return null;
  const fresh = refresh(parseState(stored.state), stored.version, now);
  if (JSON.stringify(fresh) !== stored.state) native?.setLookBudget?.(JSON.stringify(fresh));
  return fresh;
}

function state(): BudgetState | null {
  if (current) return current;
  current = load();
  appliedAtLaunch = current?.apply ?? "full";
  return current;
}

function save(next: BudgetState) {
  current = next;
  native?.setLookBudget?.(JSON.stringify(next));
}

const refreshNote = (last: NonNullable<BudgetState["last"]>) =>
  last.refreshMs === undefined ? "" : ` (display ${Math.round(1000 / last.refreshMs)} Hz${last.stretched ? `, ${last.stretched} stretched deadline(s) held to ${last.refreshMs.toFixed(1)} ms` : ""})`;

const describe = (next: BudgetState) =>
  `verdict ${next.verdict}, next build ${next.apply}${next.pendingOver ? ", one failing measurement waiting for a second" : ""}` +
  (next.last ? `, last ${next.last.frames} frames, median ${next.last.medianMs.toFixed(1)} ms against ${next.last.deadlineMs.toFixed(1)} ms${refreshNote(next.last)}, ${Math.round(next.last.missedShare * 100)}% missed` : "");


export const lookBudget = {
  isNative: () => typeof native?.sampleFrames === "function",
  state: (): BudgetState | null => state(),
  mode: (system: SystemLook): LookMode => {
    state();
    return mode(appliedAtLaunch, system);
  },
  describe: (): string => {
    const now = state();
    const forced = native?.lookBudget?.().forced ?? null;
    return now ? `${describe(now)}${forced ? `; lab forces ${forced}` : ""}` : "no budget (no native look)";
  },
  force: (applied: "full" | "degraded" | null) => native?.forceLookBudget?.(applied),
  reset: () => {
    const stored = native?.lookBudget?.();
    if (!stored) return;
    save(refresh(null, stored.version, Date.now()));
  },
  recordSample: (sample: FrameSample, now = Date.now()): BudgetState | null => {
    const before = state();
    if (!before) return null;
    const judgement = judge(sample);
    const next = record(before, judgement, now);
    save(next);
    labLog(`PAGELAB look budget ${judgement.conclusive ? (judgement.over ? "over" : "within") : "inconclusive"}: ${describe(next)}`);
    return next;
  },
};

export function useLookBudgetProbe(idle: boolean, system: SystemLook) {
  const probe = useRef<ReturnType<typeof createBudgetProbe> | null>(null);
  probe.current ??= createBudgetProbe({
    sample: (millis) => native?.sampleFrames?.(millis) ?? Promise.resolve(null),
    schedule: (run, millis) => {
      const timer = setTimeout(run, millis);
      return () => clearTimeout(timer);
    },
    record: (sample) => void lookBudget.recordSample(sample),
  });
  useEffect(() => {
    const now = state();
    probe.current?.update(idle, !!now && !!native?.sampleFrames && wantsMeasurement(now, system));
  }, [idle, system.reduceMotion]);
  useEffect(() => () => probe.current?.stop(), []);
}
