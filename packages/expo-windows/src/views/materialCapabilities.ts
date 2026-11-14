import { TurboModuleRegistry, type TurboModule } from "react-native";

export type MaterialCapabilities = {
  build: number;
  systemBackdrop: boolean;
  systemBackdropSupported: boolean;
  inWindowBlur: boolean;
  gradient: boolean;
  background: boolean;
};

export type MaterialPath = { path: string; reason: string; step?: string };

export type MaterialsNative = {
  capabilities(): MaterialCapabilities;
  applyWindowMaterial(windowId: string, material: string): Promise<MaterialPath>;
  clearWindowMaterial(windowId: string): Promise<boolean>;
  probeBlur(): Promise<MaterialPath>;
  probeGradient(): Promise<MaterialPath>;
};

let capabilities: MaterialCapabilities | null | undefined;

export function materialCapabilities(): MaterialCapabilities | null {
  if (capabilities !== undefined) return capabilities;
  capabilities = null;
  try {
    const native = TurboModuleRegistry.get<TurboModule & MaterialsNative>("ArdiaMaterials");
    const answer = native?.capabilities?.();
    if (answer && typeof answer === "object" && typeof answer.build === "number") capabilities = answer;
  } catch {
    capabilities = null;
  }
  return capabilities;
}

export const nativeWindowMaterial = () => materialCapabilities() !== null;

export const nativeBlur = () => materialCapabilities()?.inWindowBlur === true;

export const nativeGradient = () => materialCapabilities()?.gradient === true;

export function gradientDrawsNow(): boolean {
  if (!nativeGradient()) return false;
  try {
    const native = TurboModuleRegistry.get<TurboModule & MaterialsNative>("ArdiaMaterials");
    const draws = native?.capabilities?.().gradient === true;
    if (!draws && capabilities) capabilities = { ...capabilities, gradient: false };
    return draws;
  } catch {
    return false;
  }
}

export const GRADIENT_RECHECK_MS = 250;

export function watchGradientFailure(onFailed: () => void, after = GRADIENT_RECHECK_MS) {
  const recheck = setTimeout(() => !gradientDrawsNow() && onFailed(), after);
  return () => clearTimeout(recheck);
}
