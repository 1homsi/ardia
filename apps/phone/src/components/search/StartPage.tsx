import { useEffect, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { measuredOr, useRootSize } from "../../state/app/rootSize";
import { newIncognitoTab, newRegularTab, newTab, reopenLastClosed, showDeck } from "../../state/browse/store";
import { useSearchOpen } from "../../state/search/hooks";
import { openSettings } from "../../state/settings/hooks";
import { useCanReopen, useIncognito } from "../../state/tabs/hooks";
import { capsule, ChromeSurface, LookBackdrop, LookBackdropBase, Menu, PressScale, rolesFor, space, startLayout, startMotion, Symbol, tabsCurve, tabsLayout, useReduceMotion, useTheme, type MenuItem, type SymbolName } from "../ui";
import { StartSpaces, startBarCenterY, type StartGeometry } from "./StartSpaces";

export function StartPage() {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { width, height } = measuredOr(useRootSize(), window);
  const trayUp = useSearchOpen();
  const incognito = useIncognito();
  const canReopen = useCanReopen();
  const theme = useTheme();
  const dark = incognito || theme.dark;
  const reduceMotion = useReduceMotion();
  const [menu, setMenu] = useState(false);
  const geometry: StartGeometry = { width, height, safeSide: Math.max(insets.left, insets.right), barCenterY: startBarCenterY(height, insets.bottom) };
  const shown = useSharedValue(trayUp ? 0 : 1);
  useEffect(() => {
    shown.value = reduceMotion
      ? withTiming(trayUp ? 0 : 1, { duration: startMotion.reduced, easing: tabsCurve.easeOut })
      : withTiming(trayUp ? 0 : 1, { duration: startMotion.rise, easing: tabsCurve.depart });
  }, [trayUp, reduceMotion]);
  const contentStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: reduceMotion ? 1 : startMotion.trayScale + (1 - startMotion.trayScale) * shown.value }] }), [reduceMotion]);
  const barStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const items: MenuItem[] = [
    ...(incognito
      ? [
          { label: "New Tab", icon: "plus" as const, onPress: newRegularTab },
          { label: "New Incognito Tab", icon: "eyes" as const, onPress: newTab },
        ]
      : [{ label: "New Incognito Tab", icon: "eyes" as const, onPress: newIncognitoTab }]),
    ...(canReopen ? [{ label: "Reopen Closed Tab", icon: "arrowUturnBackward" as const, onPress: reopenLastClosed }] : []),
  ];
  const hidden = { pointerEvents: trayUp ? ("none" as const) : ("box-none" as const), importantForAccessibility: trayUp ? ("no-hide-descendants" as const) : ("auto" as const), accessibilityElementsHidden: trayUp };
  const barTop = geometry.barCenterY - startLayout.barCircle / 2;
  return (
    <View testID="startPage" style={StyleSheet.absoluteFill}>
      <LookBackdropBase themed={!incognito} incognito={incognito} />
      <LookBackdrop themed={!incognito} incognito={incognito} baseOutside veiled />
      <Animated.View testID="startContent" {...hidden} style={[StyleSheet.absoluteFill, contentStyle]}>
        <StartSpaces geometry={geometry} dark={dark} incognito={incognito} />
      </Animated.View>
      <Animated.View testID="startBar" {...hidden} style={[styles.bar, { top: barTop, paddingHorizontal: geometry.safeSide + startLayout.barSideInset }, barStyle]}>
        <CircleButton icon="squareOnSquare" label="Tabs" dark={dark} incognito={incognito} onPress={showDeck} />
        <PressScale label={incognito ? "New Incognito Tab" : "New Tab"} hint="Touch and hold for more options." onPress={newTab} onLongPress={() => setMenu(true)} style={styles.plusHit}>
          <ChromeSurface testID="startBarPlus" shape="capsule" cornerRadius={capsule(startLayout.barPlus.height)} incognito={incognito} dark={dark} style={styles.plus}>
            <View pointerEvents="none">
              <Symbol name="plus" size={startLayout.plusGlyph} color={rolesFor(dark).label} />
            </View>
          </ChromeSurface>
        </PressScale>
        <CircleButton icon="gearshape" label="Settings" dark={dark} incognito={incognito} onPress={() => openSettings()} />
      </Animated.View>
      {menu && !trayUp ? <Menu items={items} place={{ bottom: height - barTop + space.s, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }} onDismiss={() => setMenu(false)} /> : null}
    </View>
  );
}

function CircleButton({ icon, label, dark, incognito, onPress }: { icon: SymbolName; label: string; dark: boolean; incognito: boolean; onPress: () => void }) {
  return (
    <PressScale label={label} onPress={onPress} style={styles.circle}>
      <ChromeSurface testID={`startBar${label}`} shape="circle" cornerRadius={capsule(startLayout.barCircle)} incognito={incognito} dark={dark} style={styles.circle}>
        <View pointerEvents="none">
          <Symbol name={icon} size={startLayout.circleGlyph} color={rolesFor(dark).label} />
        </View>
      </ChromeSurface>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, height: startLayout.barCircle, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: startLayout.barGap },
  circle: { width: startLayout.barCircle, height: startLayout.barCircle, alignItems: "center", justifyContent: "center" },
  plusHit: { width: startLayout.barPlus.width, height: startLayout.barPlus.height },
  plus: { width: startLayout.barPlus.width, height: startLayout.barPlus.height, alignItems: "center", justifyContent: "center" },
});
