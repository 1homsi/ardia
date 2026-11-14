import { forwardRef, type ReactNode } from "react";
import type { NativeSurfaceProps } from "@ardia/shell";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { usePageCover } from "../engine/usePageCover";
import { Bands } from "./Bands";
import { parseColor, rgbaString, sampleStops, type Rgba } from "./color";
import { flatColors, gradientFill, type GradientFill } from "./gradientFill";
import { NativeMaterialGradient, nativeGradient } from "./nativeMaterials";
import { RoundedShadow } from "./RoundedShadow";
import { shadowSpec } from "./shadowLayers";
import { colorOrUndefined, finite, useFirstWindow } from "./shared";

function gradientBorderSides(colors: unknown): ViewStyle | null {
  if (!Array.isArray(colors) || colors.length < 2) return null;
  const stops = colors.map(parseColor).filter((stop): stop is Rgba => !!stop);
  if (stops.length < 2) return null;
  const middle = rgbaString(sampleStops(stops, 0.5));
  return { borderTopColor: rgbaString(stops[0]!), borderBottomColor: rgbaString(stops[stops.length - 1]!), borderLeftColor: middle, borderRightColor: middle };
}

const CLEAR_BORDER = "rgba(0,0,0,0)";
const TOP_TO_BOTTOM = 180;
const LEFT_TO_RIGHT = 90;

function GradientLayer({ gradient, corner }: { gradient: GradientFill; corner: number }) {
  const clip: ViewStyle | null = corner > 0 ? { borderRadius: corner, overflow: "hidden" } : null;
  if (!nativeGradient()) return <Bands stops={gradient.stops} angle={TOP_TO_BOTTOM} borderRadius={corner} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, clip]}>
      <NativeMaterialGradient
        pointerEvents="none"
        colors={flatColors(gradient.stops)}
        stops={gradient.places}
        angle={TOP_TO_BOTTOM}
        span="unit"
        reach={1}
        fade={gradient.fade}
        fadeStops={gradient.fadePlaces}
        fadeAngle={LEFT_TO_RIGHT}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export const Surface = forwardRef<View, NativeSurfaceProps>(function Surface(
  { fill, fillColors, fillStops, fade, fadeStops, cornerRadius, borderColor, borderWidth, borderColors, surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, surfaceShadowOffset, style, onLayout, children, ...rest },
  ref,
) {
  useFirstWindow();
  const corner = Math.max(0, finite(cornerRadius, 0));
  const cover = usePageCover(ref, onLayout, corner);
  const gradient = gradientFill({ fill, fillColors, fillStops, fade, fadeStops });
  const own = gradient ? { ref, onLayout } : { ref: cover.ref, onLayout: cover.onLayout };
  const within = (content: ReactNode) => (gradient ? content : cover.within(content));
  const painted = gradient && <GradientLayer gradient={gradient} corner={corner} />;
  const width = Math.max(0, finite(borderWidth, 0));
  const offset = Array.isArray(surfaceShadowOffset) ? surfaceShadowOffset : [0, 0];
  const gradientBorder = width > 0 ? gradientBorderSides(borderColors) : null;
  const solid = width > 0 && !gradientBorder ? colorOrUndefined(borderColor) : undefined;
  const border: ViewStyle | null = gradientBorder ? { borderWidth: width, ...gradientBorder } : solid ? { borderWidth: width, borderColor: solid } : null;
  const face: ViewStyle = { backgroundColor: gradient ? undefined : colorOrUndefined(fill), borderRadius: corner, ...border };
  const shadow = shadowSpec(surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, offset[0], offset[1]);
  if (!shadow) {
    return (
      <View {...rest} ref={own.ref} onLayout={own.onLayout} style={[face, style]}>
        {painted}
        {within(children)}
      </View>
    );
  }
  const inset = border ? -width : 0;
  const around = { top: inset, left: inset, right: inset, bottom: inset };
  const frame: ViewStyle = { borderRadius: corner, ...(border ? { borderWidth: width, borderColor: CLEAR_BORDER } : null) };
  return (
    <View {...rest} ref={own.ref} onLayout={own.onLayout} style={[frame, style]}>
      <RoundedShadow spec={shadow} cornerRadius={corner} around={around} />
      <View pointerEvents="none" style={[face, { position: "absolute", ...around }]}>
        {painted}
      </View>
      {within(children)}
    </View>
  );
});
