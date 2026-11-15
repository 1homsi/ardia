import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type ViewInstance } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { newTab } from "../../state/browse/store";
import { countUsage } from "../../state/telemetry/telemetry";
import { noteDeckBarTop, watchDeckBar } from "../../state/toasts/store";
import { capsule, ChromeSurface, deckChromeLayout, deckChromeMotion, font, Symbol, tabsCurve, useTheme } from "../ui";
import { useKeyboardHeight } from "../search/useKeyboardHeight";
import { GlassCircleButton, GlassPlusButton } from "./ChromeButtons";

type Props = {
  shown: boolean;
  barCenterY: number;
  deckHeight: number;
  safeSide: number;
  incognito: boolean;
  onGrid: () => void;
  onQuery: (needle: string) => void;
  onPlusMenu: () => void;
};

export const deckBarAboveKeyboard = (deckHeight: number, keyboard: number) => deckHeight - keyboard - deckChromeLayout.barGap - deckChromeLayout.barCircle / 2;

export function DeckBottomBar({ shown, barCenterY, deckHeight, safeSide, incognito, onGrid, onQuery, onPlusMenu }: Props) {
  const roles = useTheme();
  const dark = roles.dark;
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const needle = useRef("");
  const input = useRef<TextInputInstance>(null);
  const row = useRef<ViewInstance>(null);
  const keyboard = useKeyboardHeight(shown);
  const lift = focused && keyboard > 0 ? Math.max(0, barCenterY - deckBarAboveKeyboard(deckHeight, keyboard)) : 0;
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.value = withTiming(-lift, { duration: deckChromeMotion.keyboard, easing: tabsCurve.easeOut });
  }, [lift]);
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));
  const measure = () =>
    row.current?.measureInWindow((_x, y, _width, height) => {
      if (height > 0) noteDeckBarTop(y);
    });
  useEffect(() => {
    watchDeckBar(measure);
    return () => watchDeckBar(null);
  }, []);
  useEffect(() => {
    if (shown) return;
    input.current?.blur();
    needle.current = "";
    setText("");
    setFocused(false);
  }, [shown]);
  const change = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === needle.current) return;
    needle.current = trimmed;
    onQuery(trimmed);
  };
  const focus = () => {
    setFocused(true);
    if (!incognito) countUsage("search_tabs_opened");
  };
  return (
    <Animated.View pointerEvents="box-none" style={[styles.place, { top: barCenterY - deckChromeLayout.barCircle / 2 }, riseStyle]}>
      <View ref={row} testID="deckBottomBar" onLayout={measure} pointerEvents="box-none" style={[styles.bar, { paddingHorizontal: safeSide + deckChromeLayout.barSideInset }]}>
        <GlassCircleButton
          icon="squareGrid2x2"
          label="Show as Grid"
          testID="deckBarGrid"
          diameter={deckChromeLayout.barCircle}
          dark={dark}
          onPress={() => {
            input.current?.blur();
            onGrid();
          }}
        />
        <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.searchHit}>
          <ChromeSurface testID="deckSearchTabs" shape="capsule" cornerRadius={capsule(deckChromeLayout.barCircle)} dark={dark} style={[styles.search, { paddingRight: text ? deckChromeLayout.searchTrailFilled : deckChromeLayout.searchTrail }]}>
            <View pointerEvents="none">
              <Symbol name="magnifyingglass" size={deckChromeLayout.searchGlyph} color={roles.secondaryLabel} />
            </View>
            <TextInput
              ref={input}
              testID="deckSearchField"
              accessibilityLabel="Search Tabs"
              placeholder="Search Tabs"
              placeholderTextColor={roles.secondaryLabel}
              value={text}
              onChangeText={change}
              onFocus={focus}
              onBlur={() => setFocused(false)}
              onSubmitEditing={() => input.current?.blur()}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              keyboardAppearance={dark ? "dark" : "light"}
              style={[font.callout, styles.field, { color: roles.label }]}
            />
            {text ? (
              <Pressable testID="deckSearchClear" accessibilityRole="button" accessibilityLabel="Clear Search" onPress={() => change("")} style={styles.clear}>
                <Symbol name="xmarkCircleFill" size={deckChromeLayout.clearGlyph} color={roles.secondaryLabel} />
              </Pressable>
            ) : null}
          </ChromeSurface>
        </Pressable>
        <GlassPlusButton width={deckChromeLayout.barCircle} label={incognito ? "New Incognito Tab" : "New Tab"} testID="deckBarPlus" dark={dark} onPress={newTab} onLongPress={onPlusMenu} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  place: { position: "absolute", left: 0, right: 0 },
  bar: { height: deckChromeLayout.barCircle, flexDirection: "row", alignItems: "center", gap: deckChromeLayout.barGap },
  searchHit: { flex: 1, height: deckChromeLayout.barCircle },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: deckChromeLayout.searchSpacing, paddingLeft: deckChromeLayout.searchLead },
  field: { flex: 1, paddingVertical: 0 },
  clear: { width: deckChromeLayout.clearHit, height: deckChromeLayout.clearHit, alignItems: "center", justifyContent: "center" },
});
