import { pages } from "@ardia/phone-native";
import type { LaunchValue } from "../lib/launchArguments";

type WithArguments = { arguments?: Record<string, LaunchValue> } | null;

export function launchValues(): Record<string, LaunchValue> {
  try {
    return (pages.launchOptions() as WithArguments)?.arguments ?? {};
  } catch {
    return {};
  }
}
