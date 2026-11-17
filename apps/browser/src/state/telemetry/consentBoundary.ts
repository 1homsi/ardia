import { setConsentEpoch } from "../../platform/focus";
import { consentGeneration, useTelemetry } from "./choice";
import { takeContentDriftCounts, takeMainProcessWork } from "./diagnostics";
import { takeHourlyExtras } from "./hourlyExtras";
import { takeOmniboxLatency, takeSearchSuggests } from "./track";

let dropUsageCounts = () => {};

useTelemetry.subscribe((current, previous) => {
  if (current.sharing === previous.sharing) return;
  setConsentEpoch(consentGeneration());
  dropUsageCounts();
  takeHourlyExtras();
  takeOmniboxLatency();
  takeSearchSuggests();
  void takeMainProcessWork().catch(() => null);
  void takeContentDriftCounts().catch(() => null);
});

export function watchConsentBoundary(dropUsage: () => void) {
  dropUsageCounts = dropUsage;
}
