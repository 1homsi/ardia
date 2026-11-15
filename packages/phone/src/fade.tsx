import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { createElement, type ComponentType } from "react";
import { Platform, View, type ViewProps } from "react-native";
import { IPHONE_FADE_PROPS, nativeFadeProps, type FadeEdge, type FadeEdges } from "./fadeProps";

export type { FadeEdge } from "./fadeProps";

export type FadeViewProps = ViewProps & FadeEdges;

const hasNative = requireOptionalNativeModule("ArdiaPhoneFade") !== null;

type NativeFadeProps = ViewProps & Partial<Record<"topFade" | "bottomFade" | "leadingFade" | "trailingFade" | "top" | "bottom" | "leading" | "trailing", FadeEdge>>;

let nativeView: ComponentType<NativeFadeProps> | undefined;
const view = () => (nativeView ??= requireNativeViewManager<NativeFadeProps>("ArdiaPhoneFade"));

export const fadeIsNative = () => hasNative;

export function FadeView(props: FadeViewProps) {
  const { top, bottom, leading, trailing, ...rest } = props;
  if (!hasNative) return createElement(View, rest);
  const edges = Platform.OS === "ios" ? nativeFadeProps({ top, bottom, leading, trailing }, IPHONE_FADE_PROPS) : nativeFadeProps({ top, bottom, leading, trailing });
  return createElement(view(), { ...rest, ...edges } as NativeFadeProps);
}
