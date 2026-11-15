import { createContext, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import { EDGE_FADE, EDGE_FADE_FLOOR, EDGE_FADE_ONSET } from "./tokens";

export type Place = () => readonly [left: number, width: number] | null;
type Entry = { centre: Animated.Value; place: Place; last: number };

export type EdgeFade = {
  scrollX: Animated.Value;
  viewport: Animated.Value;
  maxScroll: Animated.Value;
  rightEdge: Animated.AnimatedAddition<number>;
  scrolled: Animated.AnimatedInterpolation<number>;
  remaining: Animated.AnimatedInterpolation<number>;
  entries: Set<Entry>;
  origin: number;
};

const clamp = { extrapolate: "clamp" as const };
const OFFSTAGE = -1e6;

export function createEdgeFade(scrollX: Animated.Value): EdgeFade {
  const viewport = new Animated.Value(0);
  const maxScroll = new Animated.Value(0);
  return {
    scrollX,
    viewport,
    maxScroll,
    rightEdge: Animated.add(scrollX, viewport),
    scrolled: scrollX.interpolate({ inputRange: [0, EDGE_FADE_ONSET], outputRange: [0, 1], ...clamp }),
    remaining: Animated.subtract(maxScroll, scrollX).interpolate({ inputRange: [0, EDGE_FADE_ONSET], outputRange: [0, 1], ...clamp }),
    entries: new Set(),
    origin: 0,
  };
}

const centreOf = (fade: EdgeFade, place: Place) => {
  const p = place();
  return p ? fade.origin + p[0] + p[1] / 2 : OFFSTAGE;
};

function refreshEntry(fade: EdgeFade, entry: Entry) {
  const centre = centreOf(fade, entry.place);
  if (Math.abs(centre - entry.last) < 0.25) return;
  entry.last = centre;
  entry.centre.setValue(centre);
}

export function refreshEdgeFade(fade: EdgeFade, origin: number) {
  fade.origin = origin;
  for (const entry of fade.entries) refreshEntry(fade, entry);
}

export const EdgeFadeContext = createContext<EdgeFade | null>(null);

export function edgeOpacityAt(scroll: number, centre: number, viewport: number, content: number): number {
  const ramp = (x: number) => Math.max(0, Math.min(1, x));
  const end = Math.max(0, content - viewport);
  const left = ramp(1 - (centre - scroll) / EDGE_FADE) * ramp(scroll / EDGE_FADE_ONSET);
  const right = ramp(1 - (scroll + viewport - centre) / EDGE_FADE) * ramp((end - scroll) / EDGE_FADE_ONSET);
  return 1 - (1 - EDGE_FADE_FLOOR) * Math.min(1, left + right);
}

export function useEdgeOpacity(place: Place): Animated.AnimatedInterpolation<number> | 1 {
  const fade = useContext(EdgeFadeContext);
  const latest = useRef(place);
  latest.current = place;
  const entry = useMemo<Entry | null>(() => (fade ? { centre: new Animated.Value(centreOf(fade, () => latest.current())), place: () => latest.current(), last: NaN } : null), [fade]);
  const opacity = useMemo(() => {
    if (!fade || !entry) return 1;
    const left = Animated.subtract(entry.centre, fade.scrollX).interpolate({ inputRange: [0, EDGE_FADE], outputRange: [1, 0], ...clamp });
    const right = Animated.subtract(fade.rightEdge, entry.centre).interpolate({ inputRange: [0, EDGE_FADE], outputRange: [1, 0], ...clamp });
    return Animated.add(Animated.multiply(left, fade.scrolled), Animated.multiply(right, fade.remaining)).interpolate({ inputRange: [0, 1], outputRange: [1, EDGE_FADE_FLOOR], ...clamp });
  }, [fade, entry]);
  useLayoutEffect(() => {
    if (!fade || !entry) return;
    fade.entries.add(entry);
    refreshEntry(fade, entry);
    return () => void fade.entries.delete(entry);
  }, [fade, entry]);
  return opacity;
}
