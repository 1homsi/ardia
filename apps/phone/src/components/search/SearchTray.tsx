import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateRow, cancelSearch, submitSearch, toggleTrayIncognito } from "../../state/browse/store";
import { menuOpenedHaptic, trayRowActions } from "../../state/browse/tabMenus";
import { useSearchFieldVersion, useSearchInitialText, useSearchOpen, useSearchOrigin, useSearchRows, useSearchSession, useSearchText } from "../../state/search/hooks";
import { initialPresence, presenceSettled, presenceShown, presenceTarget } from "../../lib/sheetPresence";
import { keyboardIsUp, keyboardProgress, liveLift, TRAY_LIFT, trayMaxHeight, trayOffset } from "../../lib/trayMotion";
import { wholeRowsHeight } from "../../lib/trayRows";
import { refinedText, type TrayRow } from "../../state/search/omnibox";
import { searchState, setSearchText, typeSearch } from "../../state/search/store";
import { useIncognito } from "../../state/tabs/hooks";
import { browseLayout, capsule, FloatingMenu, font, ink, LookFrost, radius, rolesFor, space, springs, Symbol, SURFACES_FROST, tabsCurve, tabsInk, tabsLayout, trayMotion, trayShadow, useTheme } from "../ui";
import { SuggestionRow } from "./SuggestionRow";
import { canSearchByVoice, presentVoiceSearch } from "../../state/voice/store";

const LARGE_FONT_SCALE = 1.5;
import { useTrayKeyboard } from "./useTrayKeyboard";

const SHEET_ABOVE_KEYBOARD = 274;


function useTrayTheme() {
  const base = useTheme();
  const incognito = useIncognito();
  return incognito ? { ...base, ...rolesFor(true), surface: tabsInk.incognitoSheet } : base;
}

export function SearchTray() {
  const open = useSearchOpen();
  const session = useSearchSession();
  const target = open ? session : null;
  const presence = useRef(initialPresence<number>(target));
  const [presentation, setPresentation] = useState(0);
  const [, redraw] = useState(0);
  useEffect(() => {
    const wasClosing = presence.current.target === null && presence.current.mounted !== null;
    const step = presenceTarget(presence.current, target);
    presence.current = step.presence;
    if (step.motion === "in" && (step.fromHidden || wasClosing)) setPresentation((count) => count + 1);
  }, [target]);
  const shown = target ?? presenceShown(presence.current);
  if (shown === null) return null;
  const generation = presence.current.generation;
  const closed = (finished: number) => {
    const next = presenceSettled(presence.current, finished, true);
    if (next === presence.current) return;
    presence.current = next;
    redraw((count) => count + 1);
  };
  return <TrayLayer key={presentation} session={shown} closing={target === null} generation={generation} onClosed={closed} />;
}

type LayerProps = { session: number; closing: boolean; generation: number; onClosed: (generation: number) => void };

function TrayLayer({ session, closing, generation, onClosed }: LayerProps) {
  const origin = useSearchOrigin();
  const theme = useTrayTheme();
  const incognito = useIncognito();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const keyboard = useTrayKeyboard();
  const landing = useSharedValue(0);
  const hasLanded = useSharedValue(false);
  const isClosing = useSharedValue(closing);
  const dim = useSharedValue(0);
  const safeBottom = insets.bottom;
  const preferred = SHEET_ABOVE_KEYBOARD + browseLayout.searchFieldHeight * (window.fontScale - 1);
  const trayHeight = trayMaxHeight(preferred, window.height - insets.top, Math.max(keyboard.target, safeBottom), space.s);
  const extend = window.height;
  const closeOnTouch = useMemo(
    () =>
      Gesture.Manual().onTouchesDown((_event, manager) => {
        runOnJS(cancelSearch)();
        manager.fail();
      }),
    [],
  );

  useEffect(() => {
    if (closing) return;
    isClosing.value = false;
    const progress = keyboardProgress(keyboard.height.value, keyboard.full.value, 0);
    const landed = keyboardIsUp(keyboard.height.value) && progress >= TRAY_LIFT.landedProgress;
    hasLanded.value = landed;
    landing.value = landed ? 1 : 0;
    const land = setTimeout(() => {
      if (isClosing.value || hasLanded.value) return;
      hasLanded.value = true;
      landing.value = reduceMotion ? withTiming(1, { duration: trayMotion.reduced, easing: tabsCurve.easeOut }) : withSpring(1, springs.searchRise);
    }, TRAY_LIFT.landingDelayMs);
    return () => clearTimeout(land);
  }, [session, closing]);

  useEffect(() => {
    if (!closing) return;
    isClosing.value = true;
    Keyboard.dismiss();
    const followsKeyboard = keyboardIsUp(keyboard.height.value);
    landing.value = followsKeyboard
      ? 0
      : reduceMotion
        ? withTiming(0, { duration: trayMotion.reduced, easing: tabsCurve.easeInOut })
        : withSpring(0, trayMotion.dismiss);
    let live = true;
    void (async () => {
      for (let polls = 0; polls < TRAY_LIFT.closePolls && keyboardIsUp(keyboard.height.value); polls++) await wait(TRAY_LIFT.closePollMs);
      await wait(TRAY_LIFT.removalDelayMs);
      if (live) onClosed(generation);
    })();
    return () => {
      live = false;
    };
  }, [closing]);

  useAnimatedReaction(
    () => keyboardProgress(keyboard.height.value, keyboard.full.value, 0),
    (progress) => {
      if (isClosing.value || hasLanded.value || progress < TRAY_LIFT.landedProgress) return;
      hasLanded.value = true;
      landing.value = 1;
    },
  );

  useAnimatedReaction(
    () => keyboardIsUp(keyboard.height.value) || (!isClosing.value && hasLanded.value),
    (up, was) => {
      if (up === was) return;
      dim.value = withTiming(up ? 1 : 0, { duration: reduceMotion ? trayMotion.reduced : trayMotion.dim, easing: reduceMotion ? tabsCurve.easeOut : tabsCurve.easeInOut });
    },
  );

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const trayStyle = useAnimatedStyle(() => {
    const lift = liveLift(keyboard.height.value, safeBottom, hasLanded.value, isClosing.value);
    const rise = reduceMotion ? 1 : Math.max(landing.value, keyboardProgress(keyboard.height.value, keyboard.full.value, 0));
    return {
      opacity: reduceMotion ? dim.value : 1,
      transform: [{ translateY: trayOffset(lift, 0, rise, trayHeight, radius.sheet) }],
    };
  }, [trayHeight, safeBottom, reduceMotion]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={closing ? "none" : "box-none"}>
      <Animated.View style={[StyleSheet.absoluteFill, dimStyle]}>
        <GestureDetector gesture={closeOnTouch}>
          <Pressable
            accessibilityLabel="Close Search"
            accessibilityRole="button"
            onPress={cancelSearch}
            style={[StyleSheet.absoluteFill, { backgroundColor: origin === "page" ? theme.trayDim : ink.clear }]}
          />
        </GestureDetector>
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            bottom: -extend,
            height: trayHeight + extend,
            backgroundColor: incognito ? theme.surface : ink.clear,
            shadowColor: theme.trayShadow,
            shadowOpacity: trayShadow.opacity,
            shadowRadius: trayShadow.radius,
            shadowOffset: { width: 0, height: trayShadow.offsetY },
          },
          trayStyle,
        ]}
      >
        {incognito ? null : <LookFrost source={SURFACES_FROST} variant="sheet" cornerRadius={radius.sheet} fill={theme.surface} style={StyleSheet.absoluteFill} />}
        <View style={{ height: trayHeight }}>
          <TrayField key={session} />
          <TrayRows />
        </View>
      </Animated.View>
    </View>
  );
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function TrayField() {
  const version = useSearchFieldVersion();
  return <FieldInput key={version} first={version === 0} />;
}

function FieldInput({ first }: { first: boolean }) {
  const theme = useTrayTheme();
  const initialText = useSearchInitialText();
  const [start] = useState(() => searchState().text);
  const [hasText, setHasText] = useState(start.length > 0);
  const input = useRef<TextInput>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    first ? (initialText ? { start: 0, end: initialText.length } : undefined) : { start: start.length, end: start.length },
  );

  useEffect(() => {
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, []);

  return (
    <View style={styles.fieldArea}>
      <View style={[styles.field, { backgroundColor: theme.fieldFill, borderColor: theme.fieldStroke }]}>
        <TextInput
          ref={input}
          style={[font.body, styles.input, { color: theme.foregroundPrimary }]}
          defaultValue={start}
          selection={selection}
          onSelectionChange={() => {
            if (selection) setSelection(undefined);
          }}
          onChangeText={(text) => {
            if (text.length > 0 !== hasText) setHasText(text.length > 0);
            typeSearch(text);
          }}
          onSubmitEditing={(event) => submitSearch(event.nativeEvent.text)}
          placeholder="Search…"
          accessibilityLabel="Search or Enter Address"
          placeholderTextColor={theme.foregroundTertiary}
          selectionColor={theme.formAccent}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          submitBehavior="submit"
          disableFullscreenUI
        />
        {hasText ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear Text" style={styles.accessory} onPress={() => setSearchText("")}>
            <Symbol name="xmarkCircleFill" size={18} color={theme.foregroundTertiary} />
          </Pressable>
        ) : (
          <VoiceButton />
        )}
        <IncognitoToggle />
      </View>
    </View>
  );
}

function VoiceButton() {
  const theme = useTrayTheme();
  const incognito = useIncognito();
  const { fontScale } = useWindowDimensions();
  if (incognito || fontScale > LARGE_FONT_SCALE || !canSearchByVoice()) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Voice Search" style={styles.accessory} onPress={presentVoiceSearch}>
      <Symbol name="mic" size={19} color={theme.foregroundTertiary} />
    </Pressable>
  );
}

function IncognitoToggle() {
  const theme = useTrayTheme();
  const on = useIncognito();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? "Deactivate Incognito" : "Activate Incognito"}
      onPress={toggleTrayIncognito}
      style={styles.incognito}
    >
      {on ? <Text style={[font.footnote, styles.medium, { color: tabsInk.onDarkSoft }]}>Incognito</Text> : null}
      <Symbol name="eyeglasses" size={22} color={on ? tabsInk.onDark : theme.foregroundTertiary} />
    </Pressable>
  );
}

function TrayRows() {
  const theme = useTrayTheme();
  const rows = useSearchRows();
  const typed = useSearchText();
  const incognito = useIncognito();
  const [room, setRoom] = useState(0);
  const [bottoms, setBottoms] = useState<number[]>([]);
  const refine = useCallback((row: TrayRow) => setSearchText(refinedText(row)), []);
  const [menu, setMenu] = useState<{ row: TrayRow; y: number } | null>(null);
  const window = useWindowDimensions();
  const showMenu = useCallback((row: TrayRow, y: number) => {
    if (!trayRowActions(row).length) return;
    menuOpenedHaptic();
    setMenu({ row, y });
  }, []);
  const shown = wholeRowsHeight(
    rows.map((_row, index) => bottoms[index] ?? 0),
    room,
  );
  if (incognito && !typed.trim()) {
    return (
      <View style={[styles.rows, styles.incognitoNote]}>
        <Text style={[font.title3, styles.medium, { color: tabsInk.onDarkSoft }]}>You’re browsing Incognito</Text>
      </View>
    );
  }
  return (
    <View style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
      <ScrollView
        style={shown === null ? styles.rows : { height: shown, flexGrow: 0 }}
        contentContainerStyle={styles.rowsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {rows.map((row, index) => (
          <View
            key={index}
            onLayout={(event) => {
              const bottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
              setBottoms((known) => (known[index] === bottom ? known : Object.assign([...known], { [index]: bottom })));
            }}
          >
            <SuggestionRow row={row} typed={typed} roles={theme} onActivate={activateRow} onRefine={refine} onMenu={showMenu} />
          </View>
        ))}
      </ScrollView>
      {menu ? (
        <FloatingMenu
          items={trayRowActions(menu.row).map((action) => ({ label: action.label, icon: action.icon, onPress: action.run }))}
          place={{
            top: Math.max(space.l, Math.min(menu.y, window.height - tabsLayout.cardMenuHeight)),
            left: space.xl,
            width: Math.min(tabsLayout.menuWidth, window.width - space.xl * 2),
          }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    elevation: trayShadow.elevation,
    overflow: "hidden",
  },
  fieldArea: { paddingHorizontal: browseLayout.searchFieldInset, paddingTop: browseLayout.trayFieldTop, paddingBottom: space.s },
  field: {
    minHeight: browseLayout.searchFieldHeight,
    borderRadius: capsule(browseLayout.searchFieldHeight),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: browseLayout.fieldLeading,
    paddingRight: browseLayout.fieldTrailing,
  },
  input: { flex: 1, paddingVertical: 0, minHeight: browseLayout.searchFieldHeight },
  accessory: { width: browseLayout.accessory.width, height: browseLayout.accessory.height, alignItems: "center", justifyContent: "center" },
  rows: { flex: 1 },
  incognito: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    minWidth: 36,
    minHeight: 40,
    justifyContent: "flex-end",
    paddingLeft: space.xs + 2,
  },
  incognitoNote: { alignItems: "center", paddingTop: space.huge },
  medium: { fontWeight: "500" },
  rowsContent: { paddingHorizontal: space.s, paddingBottom: space.s },
});
