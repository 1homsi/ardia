import { requireNativeView } from "expo";
import { requireOptionalNativeModule } from "expo-modules-core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { Platform } from "react-native";
import type { LookColors } from "./look";

export type ModifierConfig = { $type: string; [key: string]: unknown; eventListener?: (args: unknown) => void };

type ModifierHelpers = {
  createModifier: (type: string, params?: Record<string, unknown>) => ModifierConfig;
  createViewModifierEventListener: (modifiers: ModifierConfig[]) => object;
};

let helpers: ModifierHelpers | undefined;
const modifierHelpers = (): ModifierHelpers =>
  (helpers ??= Platform.OS === "android" ? require("@expo/ui/jetpack-compose/modifiers") : require("@expo/ui/swift-ui/modifiers"));

export type SettingsTintName =
  | "neutral" | "red" | "orange" | "yellow" | "blue" | "deepBlue" | "purple" | "green"
  | "sync" | "ads" | "trackers" | "cookies" | "search" | "archive" | "keyboard" | "swipe" | "nightShade"
  | "appLinks" | "bottomBar" | "defaultBrowser" | "clearData" | "export" | "onboarding"
  | "swatch";

export type ProfilePresetName = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type SetupProgress = "done" | "current" | "upcoming";

export const SETTINGS_UI_MODULE = "ArdiaPhoneSettingsUI";

export const settingsUIAvailable = () => requireOptionalNativeModule(SETTINGS_UI_MODULE) !== null;

export type SettingsPieceProps = { testID?: string; modifiers?: ModifierConfig[]; children?: ReactNode };

const views = new Map<string, ComponentType<object>>();

function piece<P extends SettingsPieceProps>(name: string) {
  return function SettingsPiece(props: P) {
    if (!settingsUIAvailable()) return null;
    const native = views.get(name) ?? requireNativeView<object>(SETTINGS_UI_MODULE, name);
    views.set(name, native);
    const { modifiers, ...rest } = props;
    const listeners = modifiers?.length ? modifierHelpers().createViewModifierEventListener(modifiers) : undefined;
    return createElement(native, { ...rest, modifiers, ...listeners });
  };
}

export const SettingsIconTile = piece<SettingsPieceProps & { systemImage: string; tint: SettingsTintName; baseSide?: number }>("SettingsIconTileView");

export const SettingsRowLabel = piece<SettingsPieceProps & { title: string; systemImage: string; tint: SettingsTintName }>("SettingsRowLabelView");

export const SettingsHeroContent = piece<SettingsPieceProps & { title: string; subtitle: string; systemImage: string; tint: SettingsTintName }>("SettingsHeroContentView");

export const SetupStepRow = piece<SettingsPieceProps & { number: number; title: string; detail: string; progress: SetupProgress }>("SetupStepRowView");

export const ColorSwatch = piece<SettingsPieceProps & { preset: ProfilePresetName; isSelected: boolean }>("ColorSwatchView");

export const CheckmarkLabel = piece<SettingsPieceProps & { title: string; isChecked: boolean }>("CheckmarkLabelView");

export const AppIconPreview = piece<SettingsPieceProps & { side?: number }>("AppIconPreviewView");

const ardia = (name: string, params: Record<string, unknown> = {}): ModifierConfig | null => (settingsUIAvailable() ? modifierHelpers().createModifier(`ardia.${name}`, params) : null);

export const settingsChrome = () => ardia("settingsChrome");

export const settingsPage = (title: string) => ardia("settingsPage", { title });

export const chromeSurface = (params: { shape: "circle" | "capsule" | "rounded"; cornerRadius?: number; interactive?: boolean; tinted?: boolean }) => ardia("chromeSurface", params);

export const settingsSwitchStyle = () => ardia("settingsSwitchStyle");

export const pressableStyle = () => ardia("pressableStyle");

export const legibleInk = (tint: SettingsTintName | "formAccent") => ardia("legibleInk", { tint });

export const profileLook = (look: LookColors & { usesGlass?: boolean }) =>
  ardia("profileLook", { color: look.color ?? null, themeColors: look.themeColors ?? [], darkThemeColors: look.darkThemeColors ?? null, usesGlass: look.usesGlass ?? true });

export const modifierList = (...items: (ModifierConfig | null | undefined | false)[]): ModifierConfig[] => items.filter((item): item is ModifierConfig => !!item);
