export const LOOK_BUDGET = {
  skipAfterShownMs: 1000,
  sampleMs: 2000,
  minFrames: 20,
  maxMissedShare: 0.25,
  slowestRefreshMs: 1000 / 60,
  latchSlack: 1.5,
  retryAfterMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export type FrameSample = { totals: number[]; deadlines: number[]; refreshMs?: number };

export type Judgement = {
  conclusive: boolean;
  over: boolean;
  frames: number;
  medianMs: number;
  deadlineMs: number;
  missedShare: number;
  refreshMs?: number;
  stretched?: number;
};

export type BudgetVerdict = "unknown" | "pass" | "fail";

export type BudgetState = {
  version: string;
  verdict: BudgetVerdict;
  apply: "full" | "degraded";
  measuredAt: number | null;
  pendingOver: boolean;
  last: Judgement | null;
};

export type LookMode = "full" | "no_blur" | "no_motion" | "neither";

export type SystemLook = { reduceMotion: boolean; reduceTransparency: boolean };

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export const refreshInterval = (displayMs: number | undefined): number | undefined =>
  displayMs === undefined || !(displayMs > 0) ? undefined : Math.min(displayMs, LOOK_BUDGET.slowestRefreshMs);

export function frameDeadline(ownMs: number, refreshMs: number | undefined): number {
  if (refreshMs === undefined) return ownMs;
  return ownMs > 0 && ownMs <= refreshMs * LOOK_BUDGET.latchSlack ? ownMs : refreshMs;
}

export function judge(sample: FrameSample): Judgement {
  const frames = Math.min(sample.totals.length, sample.deadlines.length);
  const totals = sample.totals.slice(0, frames);
  const refreshMs = refreshInterval(sample.refreshMs);
  const deadlines = sample.deadlines.slice(0, frames).map((own) => frameDeadline(own, refreshMs));
  const stretched = sample.deadlines.slice(0, frames).filter((own, index) => own !== deadlines[index]).length;
  const medianMs = median(totals);
  const deadlineMs = median(deadlines);
  const missed = totals.filter((total, index) => total > deadlines[index]!).length;
  const missedShare = frames === 0 ? 0 : missed / frames;
  const conclusive = frames >= LOOK_BUDGET.minFrames;
  const over = conclusive && (medianMs > deadlineMs || missedShare > LOOK_BUDGET.maxMissedShare);
  return { conclusive, over, frames, medianMs, deadlineMs, missedShare, ...(refreshMs === undefined ? {} : { refreshMs, stretched }) };
}

export const initialState = (version: string): BudgetState => ({ version, verdict: "unknown", apply: "full", measuredAt: null, pendingOver: false, last: null });

export function refresh(state: BudgetState | null, version: string, now: number): BudgetState {
  if (!state) return initialState(version);
  const updated = state.version !== version;
  if (state.verdict === "fail" && state.apply === "degraded" && (updated || (state.measuredAt !== null && now - state.measuredAt >= LOOK_BUDGET.retryAfterMs))) {
    return { ...state, version, apply: "full", pendingOver: false };
  }
  if (state.verdict === "pass" && updated) return { ...state, version, verdict: "unknown", apply: "full", pendingOver: false };
  return updated ? { ...state, version } : state;
}

export const wantsMeasurement = (state: BudgetState, system: SystemLook): boolean =>
  state.apply === "full" && state.verdict !== "pass" && !system.reduceMotion;

export function record(state: BudgetState, judgement: Judgement, now: number): BudgetState {
  if (!judgement.conclusive) return state;
  if (!judgement.over) return { ...state, verdict: "pass", apply: "full", measuredAt: now, pendingOver: false, last: judgement };
  if (!state.pendingOver) return { ...state, pendingOver: true, last: judgement };
  return { ...state, verdict: "fail", apply: "degraded", measuredAt: now, pendingOver: false, last: judgement };
}

export function mode(applied: "full" | "degraded", system: SystemLook): LookMode {
  const noBlur = applied === "degraded" || system.reduceTransparency;
  const noMotion = applied === "degraded" || system.reduceMotion;
  if (noBlur && noMotion) return "neither";
  if (noBlur) return "no_blur";
  if (noMotion) return "no_motion";
  return "full";
}

export function parseState(text: string | null | undefined): BudgetState | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<BudgetState>;
    if (typeof value.version !== "string" || (value.apply !== "full" && value.apply !== "degraded")) return null;
    if (value.verdict !== "unknown" && value.verdict !== "pass" && value.verdict !== "fail") return null;
    return {
      version: value.version,
      verdict: value.verdict,
      apply: value.apply,
      measuredAt: typeof value.measuredAt === "number" ? value.measuredAt : null,
      pendingOver: value.pendingOver === true,
      last: value.last ?? null,
    };
  } catch {
    return null;
  }
}

export type ProbeDeps = {
  sample: (millis: number) => Promise<FrameSample | null>;
  schedule: (run: () => void, millis: number) => () => void;
  record: (sample: FrameSample) => void;
};

export function createBudgetProbe(deps: ProbeDeps) {
  let measured = false;
  let generation = 0;
  let cancel: (() => void) | null = null;
  const stop = () => {
    generation += 1;
    cancel?.();
    cancel = null;
  };
  return {
    update(idle: boolean, wanted: boolean) {
      stop();
      if (measured || !idle || !wanted) return;
      const mine = generation;
      cancel = deps.schedule(() => {
        deps.sample(LOOK_BUDGET.sampleMs).then(
          (sample) => {
            if (mine !== generation || measured || !sample) return;
            measured = true;
            deps.record(sample);
          },
          () => undefined,
        );
      }, LOOK_BUDGET.skipAfterShownMs);
    },
    stop,
    get measured() {
      return measured;
    },
  };
}
