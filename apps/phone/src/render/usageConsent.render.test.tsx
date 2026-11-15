const mockConsent: boolean[] = [];

jest.mock("../platform/telemetry", () => ({
  ...jest.requireActual("../platform/telemetry"),
  canPostTelemetry: () => false,
  setUsageConsent: (sharing: boolean) => mockConsent.push(sharing),
  takePendingCounts: () => ({}),
}));

const { setUsageSharing, startTelemetry } = require("../state/telemetry/telemetry") as typeof import("../state/telemetry/telemetry");

test("native counts follow usage consent: told the saved choice at start, then every change", () => {
  jest.useFakeTimers();
  startTelemetry();
  expect(mockConsent).toEqual([false]);
  setUsageSharing(true, "settings");
  setUsageSharing(false, "settings");
  expect(mockConsent).toEqual([false, true, false]);
  jest.useRealTimers();
});
