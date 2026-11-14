import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, FadeIn, FadeOut, runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { GestureType } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateRow, cancelSearch, submitSearch, toggleTrayIncognito } from "../../state/browse/store";
import { menuOpenedHaptic, trayRowActions } from "../../state/browse/tabMenus";
import { useSearchFieldVersion, useSearchInitialText, useSearchOpen, useSearchOrigin, useSearchRows, useSearchSession, useSearchText } from "../../state/search/hooks";
import { initialPresence, presenceSettled, presenceShown, presenceTarget } from "../../lib/sheetPresence";
import { clampedProgress, keyboardIsUp, keyboardProgress, liveLift, TRAY_LIFT, trayDragDismisses, trayDragOffset, trayDragReleasesKeyboard, trayMaxHeight, trayOffset } from "../../lib/trayMotion";
import { useOnboarding } from "../../state/onboarding/store";
import { useVoice } from "../../state/voice/store";
import { idleScrub, releaseRefines, scrubBegin, scrubEnd, scrubMove, type RowFrame, type ScrubState } from "../../lib/trayScrub";
import { wholeRowsHeight } from "../../lib/trayRows";
import { confirmHaptic, selectionHaptic } from "../../platform/system";
import { refinedText, type TrayRow } from "../../state/search/omnibox";
import { searchState, setSearchText, typeSearch } from "../../state/search/store";
import { useIncognito } from "../../state/tabs/hooks";
import { browseLayout, capsule, FloatingMenu, font, ink, LookFrost, radius, rolesFor, space, springs, Symbol, SURFACES_FROST, tabsCurve, tabsInk, tabsLayout, tabsMotion, trayMotion, trayShadow, useTheme } from "../ui";
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
  const drag = useSharedValue(0);
  const dragging = useSharedValue(false);
  const released = useSharedValue(false);
  const heldLift = useSharedValue(-1);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const settleAfterDrag = () => {
    if (heldLift.value < 0 || isClosing.value) return;
    if (mayFocusTray()) focusTray();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (heldLift.value < 0 || isClosing.value) return;
      const to = liveLift(keyboard.height.value, safeBottom, hasLanded.value, false);
      heldLift.value = reduceMotion
        ? withTiming(to, { duration: trayMotion.reduced, easing: tabsCurve.easeOut }, (finished) => {
            if (finished) heldLift.value = -1;
          })
        : withSpring(to, trayMotion.settle, (finished) => {
            if (finished) heldLift.value = -1;
          });
    }, TRAY_LIFT.settleHoldMs);
  };
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const voice = useVoice((state) => state.presented);
  const voiceWasUp = useRef(voice);
  useEffect(() => {
    if (closing) return;
    if (voice) trayInput?.blur();
    else if (voiceWasUp.current && mayFocusTray()) focusTray();
    voiceWasUp.current = voice;
  }, [voice, closing]);

  const dismissDrag = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!closing)
        .activeOffsetY([-10, 10])
        .failOffsetX([-24, 24])
        .onStart(() => {
          cancelAnimation(drag);
          dragging.value = true;
          released.value = false;
        })
        .onUpdate((event) => {
          if (!released.value && trayDragReleasesKeyboard(event.translationY)) {
            released.value = true;
            if (heldLift.value < 0) heldLift.value = liveLift(keyboard.height.value, safeBottom, hasLanded.value, isClosing.value);
            runOnJS(Keyboard.dismiss)();
          }
          drag.value = trayDragOffset(event.translationY);
        })
        .onEnd((event) => {
          dragging.value = false;
          if (trayDragDismisses(event.translationY, event.velocityY, trayHeight)) {
            runOnJS(cancelSearch)();
            return;
          }
          drag.value = reduceMotion ? withTiming(0, { duration: trayMotion.reduced, easing: tabsCurve.easeOut }) : withSpring(0, trayMotion.settle);
          runOnJS(settleAfterDrag)();
        }),
    [closing, trayHeight, safeBottom, reduceMotion],
  );

  useAnimatedReaction(
    () => (heldLift.value >= 0 && !dragging.value ? Math.abs(liveLift(keyboard.height.value, safeBottom, hasLanded.value, isClosing.value) - heldLift.value) : Infinity),
    (gap) => {
      if (gap < TRAY_LIFT.heldReleaseTolerance) heldLift.value = -1;
    },
  );

  useEffect(() => {
    if (!closing) return;
    isClosing.value = true;
    Keyboard.dismiss();
    const followsKeyboard = keyboardIsUp(keyboard.height.value) && heldLift.value < 0;
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

  const currentLift = () => {
    "worklet";
    return heldLift.value >= 0 ? heldLift.value : liveLift(keyboard.height.value, safeBottom, hasLanded.value, isClosing.value);
  };
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value * (1 - clampedProgress(drag.value, trayHeight + currentLift())) }), [trayHeight, safeBottom]);
  const trayStyle = useAnimatedStyle(() => {
    const lift = currentLift();
    const rise = reduceMotion ? 1 : Math.max(landing.value, keyboardProgress(keyboard.height.value, keyboard.full.value, 0));
    return {
      opacity: reduceMotion ? dim.value : 1,
      transform: [{ translateY: trayOffset(lift, drag.value, rise, trayHeight, radius.sheet) }],
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
          <GestureDetector gesture={dismissDrag}>
            <View collapsable={false}>
              <TrayField key={session} />
            </View>
          </GestureDetector>
          <TrayRows dismissDrag={dismissDrag} />
        </View>
      </Animated.View>
    </View>
  );
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const resultsIn = FadeIn.duration(trayMotion.resultsIn);
const resultsOut = FadeOut.duration(trayMotion.resultsIn);

const modeToggleIn = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: { opacity: withSpring(1, trayMotion.modeToggle), transform: [{ scale: withSpring(1, trayMotion.modeToggle) }] },
  };
};

const modeToggleOut = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withSpring(0, trayMotion.modeToggle), transform: [{ scale: withSpring(0.9, trayMotion.modeToggle) }] },
  };
};

let trayInput: TextInput | null = null;

const focusTray = () => trayInput?.focus();

const mayFocusTray = () => !useOnboarding.getState().showing && !useVoice.getState().presented;

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
          ref={(field) => {
            input.current = field;
            trayInput = field;
          }}
          style={[font.title3, styles.input, { color: theme.foregroundPrimary }]}
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
      {on ? (
        <Animated.Text entering={modeToggleIn} exiting={modeToggleOut} style={[font.footnote, styles.medium, styles.toggleLabel, { color: tabsInk.onDarkSoft }]}>
          Incognito
        </Animated.Text>
      ) : null}
      <Symbol name="eyeglasses" size={22} color={on ? tabsInk.onDark : theme.foregroundTertiary} />
    </Pressable>
  );
}

function TrayRows({ dismissDrag }: { dismissDrag: GestureType }) {
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
      <GestureDetector gesture={dismissDrag}>
        <Animated.View key="caption" entering={resultsIn} exiting={resultsOut} style={[styles.rows, styles.incognitoNote]}>
          <Text style={[font.title3, styles.semibold, styles.centered, { color: tabsInk.onDarkSoft }]}>You’re browsing Incognito</Text>
        </Animated.View>
      </GestureDetector>
    );
  }
  if (!rows.length) {
    return (
      <GestureDetector gesture={dismissDrag}>
        <Animated.View key="empty" entering={resultsIn} exiting={resultsOut} style={styles.rows} collapsable={false} />
      </GestureDetector>
    );
  }
  const menuView = menu ? (
    <FloatingMenu
      items={trayRowActions(menu.row).map((action) => ({ label: action.label, icon: action.icon, onPress: action.run }))}
      place={{
        top: Math.max(space.l, Math.min(menu.y, window.height - tabsLayout.cardMenuHeight)),
        left: space.xl,
        width: Math.min(tabsLayout.menuWidth, window.width - space.xl * 2),
      }}
      onDismiss={() => setMenu(null)}
    />
  ) : null;
  const measure = (index: number, layout: { y: number; height: number }) => {
    const bottom = layout.y + layout.height;
    setBottoms((known) => (known[index] === bottom ? known : Object.assign([...known], { [index]: bottom })));
  };
  if (window.fontScale <= LARGE_FONT_SCALE) {
    return (
      <Animated.View key="rows" entering={resultsIn} exiting={resultsOut} style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
        <ScrubbedRows rows={rows} typed={typed} budget={shown ?? room} onMeasure={measure} onRefine={refine} onMenu={showMenu} />
        {menuView}
      </Animated.View>
    );
  }
  return (
    <Animated.View key="rows" entering={resultsIn} exiting={resultsOut} style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
      <ScrollView
        style={shown === null ? styles.rows : { height: shown, flexGrow: 0 }}
        contentContainerStyle={styles.rowsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {rows.map((row, index) => (
          <View key={index} onLayout={(event) => measure(index, event.nativeEvent.layout)}>
            <SuggestionRow row={row} typed={typed} roles={theme} menu={trayRowActions(row)} onActivate={activateRow} onRefine={refine} onMenu={showMenu} />
          </View>
        ))}
      </ScrollView>
      {menuView}
    </Animated.View>
  );
}

type ScrubbedProps = {
  rows: readonly TrayRow[];
  typed: string;
  budget: number;
  onMeasure: (index: number, layout: { y: number; height: number }) => void;
  onRefine: (row: TrayRow) => void;
  onMenu: (row: TrayRow, y: number) => void;
};

function ScrubbedRows({ rows, typed, budget, onMeasure, onRefine, onMenu }: ScrubbedProps) {
  const theme = useTrayTheme();
  const list = useRef<View>(null);
  const latest = useRef({ rows, onRefine, onMenu });
  latest.current = { rows, onRefine, onMenu };
  const frames = useSharedValue<(RowFrame | null)[]>([]);
  const refinable = useSharedValue<boolean[]>([]);
  const visible = useSharedValue(budget);
  const scrub = useSharedValue<ScrubState>(idleScrub);
  const press = useSharedValue(0);
  const menuTaken = useSharedValue(false);
  const drawn = useSharedValue(-1);
  const alpha = useSharedValue(0);
  useEffect(() => {
    visible.value = budget;
  }, [budget]);
  useEffect(() => {
    frames.value = frames.value.slice(0, rows.length);
    refinable.value = rows.map((row) => row.kind === "query");
  }, [rows]);

  const armLongPress = (touch: number) => {
    setTimeout(() => {
      const state = scrub.value;
      if (press.value !== touch || state.scrubbing || state.highlighted < 0) return;
      const index = state.highlighted;
      menuTaken.value = true;
      scrub.value = idleScrub;
      const row = latest.current.rows[index];
      const frame = frames.value[index];
      if (!row || !frame) return;
      list.current?.measureInWindow((_x, y) => latest.current.onMenu(row, y + frame.bottom));
    }, tabsMotion.longPress);
  };
  const release = (index: number, wasScrubbing: boolean, refine: boolean) => {
    const row = latest.current.rows[index];
    if (!row) return;
    if (wasScrubbing) void confirmHaptic().catch(() => undefined);
    if (refine) latest.current.onRefine(row);
    else activateRow(row);
  };
  const tick = () => void selectionHaptic().catch(() => undefined);

  const gesture = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((event, manager) => {
          const touch = event.allTouches[0];
          if (!touch || event.numberOfTouches > 1) {
            manager.fail();
            return;
          }
          scrub.value = scrubBegin(frames.value, touch.x, touch.y, visible.value);
          menuTaken.value = false;
          press.value += 1;
          manager.activate();
          runOnJS(armLongPress)(press.value);
        })
        .onTouchesMove((event) => {
          const touch = event.allTouches[0];
          if (!touch || menuTaken.value) return;
          const moved = scrubMove(scrub.value, frames.value, touch.x, touch.y, visible.value);
          scrub.value = moved.state;
          if (moved.ticks) runOnJS(tick)();
        })
        .onTouchesUp((event, manager) => {
          const touch = event.changedTouches[0];
          press.value += 1;
          const state = scrub.value;
          scrub.value = idleScrub;
          manager.end();
          if (!touch || menuTaken.value) return;
          const ended = scrubEnd(state, frames.value, touch.x, touch.y, visible.value);
          if (ended.kind !== "activate") return;
          runOnJS(release)(ended.index, ended.wasScrubbing, releaseRefines(ended, frames.value, touch.x, refinable.value[ended.index] ?? false));
        })
        .onTouchesCancelled((_event, manager) => {
          press.value += 1;
          scrub.value = idleScrub;
          manager.fail();
        }),
    [],
  );

  useAnimatedReaction(
    () => scrub.value.highlighted,
    (index, previous) => {
      if (index === previous) return;
      if (index >= 0) {
        const appearing = drawn.value < 0 || alpha.value < 0.01;
        drawn.value = index;
        alpha.value = appearing ? withSpring(1, trayMotion.press) : 1;
        return;
      }
      alpha.value = withSpring(0, trayMotion.press, (finished) => {
        if (finished) drawn.value = -1;
      });
    },
  );
  const highlightStyle = useAnimatedStyle(() => {
    const frame = drawn.value >= 0 ? frames.value[drawn.value] : null;
    if (!frame) return { opacity: 0 };
    return { opacity: alpha.value, top: frame.top, left: frame.left, width: frame.right - frame.left, height: frame.bottom - frame.top };
  });

  return (
    <GestureDetector gesture={gesture}>
      <View ref={list} style={[styles.rowsContent, { height: budget > 0 ? budget : undefined, overflow: "hidden" }]} collapsable={false}>
        <Animated.View pointerEvents="none" style={[styles.highlight, { backgroundColor: theme.rowHighlight }, highlightStyle]} />
        {rows.map((row, index) => (
          <View
            key={index}
            onLayout={(event) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              frames.value = Object.assign([...frames.value], { [index]: { left: x, top: y, right: x + width, bottom: y + height } });
              onMeasure(index, event.nativeEvent.layout);
            }}
          >
            <SuggestionRow row={row} typed={typed} roles={theme} interactive={false} menu={trayRowActions(row)} onActivate={activateRow} onRefine={onRefine} onMenu={onMenu} />
          </View>
        ))}
      </View>
    </GestureDetector>
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
  incognitoNote: { alignItems: "center", justifyContent: "center", paddingHorizontal: space.l },
  semibold: { fontWeight: "600" },
  centered: { textAlign: "center" },
  toggleLabel: { transformOrigin: "100% 50%" },
  medium: { fontWeight: "500" },
  rowsContent: { paddingHorizontal: space.s, paddingBottom: space.s },
  highlight: { position: "absolute", borderRadius: radius.row },
});
