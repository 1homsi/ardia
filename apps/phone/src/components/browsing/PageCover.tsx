import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PAGE_COVER, pageCoverNeeded } from "../../lib/pageCover";
import { useNavigation, usePageTone } from "../../state/browse/hooks";
import { pageNavigation } from "../../state/pages/store";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { TabFace, useTheme } from "../ui";

export function PageCover({ tab }: { tab: BrowserTab }) {
  const theme = useTheme();
  const tone = usePageTone(tab.id);
  const live = useNavigation(tab.id, (n) => n?.isLive ?? false);
  const loading = useNavigation(tab.id, (n) => n?.isLoading ?? true);
  const [needed] = useState(() => pageCoverNeeded(pageNavigation(tab.id), Boolean(tab.snapshotFileName)));
  const [gone, setGone] = useState(!needed);
  const opacity = useSharedValue(needed ? 1 : 0);
  const fading = useRef(false);
  const sawLoading = useRef(false);
  const fade = () => {
    if (fading.current) return;
    fading.current = true;
    opacity.value = withTiming(0, { duration: PAGE_COVER.fadeMs }, (finished) => {
      if (finished) runOnJS(setGone)(true);
    });
  };
  useEffect(() => {
    if (!needed) return;
    const deadline = setTimeout(fade, PAGE_COVER.deadlineMs);
    return () => clearTimeout(deadline);
  }, []);
  useEffect(() => {
    if (!needed || !live) return;
    if (loading) {
      sawLoading.current = true;
      return;
    }
    if (sawLoading.current) {
      fade();
      return;
    }
    const settle = setTimeout(fade, PAGE_COVER.settleMs);
    return () => clearTimeout(settle);
  }, [live, loading]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (gone) return null;
  const shown = display(tab.url);
  return (
    <Animated.View
      testID="pageCover"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }, style]}
    >
      <TabFace tab={tab} title={tab.title || shown.host} host={shown.host} tone={tone?.top ?? null} roles={theme} />
    </Animated.View>
  );
}
