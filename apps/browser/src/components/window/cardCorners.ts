import { createContext, useContext } from "react";
import { Animated } from "react-native";

export type CardCorner = ReturnType<typeof Animated.divide>;

export const CardBottomCorners = createContext<CardCorner | null>(null);

export const useCardBottomCorners = () => useContext(CardBottomCorners);

export function zoomedCardCorner(scale: Animated.Value, { width, height, inset, cardRadius, windowRadius }: { width: number; height: number; inset: number; cardRadius: number; windowRadius: number }): CardCorner | null {
  if (inset <= 0 || width <= 0 || height <= 0) return null;
  const touchesEdge = 1 + (2 * inset) / Math.max(width, height);
  return Animated.divide(scale.interpolate({ inputRange: [0, 1, touchesEdge], outputRange: [0, cardRadius, windowRadius], extrapolate: "clamp" }), scale);
}
