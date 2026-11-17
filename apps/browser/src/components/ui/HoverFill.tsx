import { Animated, StyleSheet } from "react-native";
import { useHoverFill } from "./motion";

export function HoverFill({ shown, color, radius, instant = false }: { shown: boolean; color: string; radius: number; instant?: boolean }) {
  const opacity = useHoverFill(shown, instant);
  if (!opacity) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: color, opacity }]} />;
}
