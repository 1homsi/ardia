import { AppState } from "react-native";
import { lookBudget, systemLook } from "../../platform/look";
import { create } from "zustand";
import { createGate, type SharingSource } from "../../lib/telemetryGate";
import { launchProps, legacyImportOutcome, pendingUsage, type Counted } from "../../lib/telemetrySchema";
import { canPostTelemetry, deviceFacts, JS_STARTED_AT, newTelemetryId, postTelemetry, processStartedAt, takePendingCounts } from "../../platform/telemetry";
import { useBoot } from "../app/bootState";
import { readPreferences, writePreference } from "../store/browserDatabase";
import { browserDatabase } from "../store/database";

const DAILY_CHECK_MS = 60 * 60_000;

export const useUsageSharing = create<{ sharing: boolean }>()(() => ({ sharing: false }));

const gate = createGate({
  store: {
    read: (key) => readPreferences(browserDatabase())[key] ?? null,
    write: (key, value) => writePreference(browserDatabase(), key, value),
  },
  post: postTelemetry,
  canPost: canPostTelemetry,
  newId: newTelemetryId,
  device: deviceFacts,
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  onChange: (sharing) => useUsageSharing.setState({ sharing }),
});

let started = false;

function countPendingUsage() {
  for (const field of pendingUsage(takePendingCounts())) gate.count(field);
}

export function startTelemetry() {
  if (started) return;
  started = true;
  gate.load();
  useUsageSharing.setState({ sharing: gate.isSharing() });
  gate.rollDaily();
  countPendingUsage();
  AppState.addEventListener("change", (next) => {
    if (next === "active") {
      gate.rollDaily();
      countPendingUsage();
    } else gate.flushNow();
  });
  setInterval(() => gate.rollDaily(), DAILY_CHECK_MS);
}

export const setUsageSharing = (on: boolean, source: SharingSource) => gate.setSharing(on, source);

export const countUsage = (field: Counted) => gate.count(field);

export const usageCountingWindow = () => gate.countingWindow();

let reported = false;

export async function reportLaunch(firstScreenAt: number) {
  if (reported || !gate.isSharing()) return;
  reported = true;
  const boot = useBoot.getState();
  const look = lookBudget.mode(await systemLook());
  gate.capture("app_launched", { legacy_import: legacyImportOutcome(boot.outcome), legacy_import_failures: boot.failures, look_mode: look });
  const timings = launchProps(await processStartedAt(), JS_STARTED_AT, firstScreenAt);
  if (timings) gate.capture("perf_launch", timings);
}
