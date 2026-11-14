import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { createElement, type ComponentType } from "react";
import { View, type ViewProps } from "react-native";

export type FadeEdge = { length: number; floor?: number };

export type FadeViewProps = ViewProps & {
  top?: FadeEdge;
  bottom?: FadeEdge;
  leading?: FadeEdge;
  trailing?: FadeEdge;
};

const hasNative = requireOptionalNativeModule("ArdiaPhoneFade") !== null;

let nativeView: ComponentType<FadeViewProps> | undefined;
const view = () => (nativeView ??= requireNativeViewManager<FadeViewProps>("ArdiaPhoneFade"));

export const fadeIsNative = () => hasNative;

export function FadeView(props: FadeViewProps) {
  if (hasNative) return createElement(view(), props);
  const { top, bottom, leading, trailing, ...rest } = props;
  return createElement(View, rest);
}
