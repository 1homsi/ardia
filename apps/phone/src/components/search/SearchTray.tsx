import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { countRender } from "../../state/app/interactionPerf";
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, FadeIn, FadeOut, runOnJS, runOnUI, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { GestureType } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateRow, cancelSearch, submitSearch, toggleTrayIncognito } from "../../state/browse/store";
import { menuOpenedHaptic, trayRowActions } from "../../state/browse/tabMenus";
import { useSearchFieldVersion, useSearchInitialText, useSearchOpen, useSearchOrigin, useSearchRows, useSearchSession, useSearchText } from "../../state/search/hooks";
import { initialPresence, presenceSettled, presenceShown, presenceTarget } from "../../lib/sheetPresence";
import { clampedProgress, keyboardIsUp, keyboardProgress, liveLift, TRAY_LIFT, trayDragDismisses, trayDragOffset, trayDragReleasesKeyboard, trayMaxHeight, trayOffset } from "../../lib/trayMotion";
import { useOnboarding } from "../../state/onboarding/store";
import { useVoice } from "../../state/voice/store";
import { idleScrub, SCRUB, scrubBegin, scrubEnd, scrubMove, type RowFrame, type ScrubState } from "../../lib/trayScrub";
import { rowFade, rowsFadeEdge, rowsOverflow, wholeRowsHeight } from "../../lib/trayRows";
import { haptics } from "../../state/app/haptics";
import { refinedText, type TrayRow } from "../../state/search/omnibox";
import { searchState, setSearchText, typeSearch } from "../../state/search/store";
import { coverTray, followTrayBack, trayBackTravel, useTrayCovers } from "../../state/search/trayBack";
import { useIncognito } from "../../state/tabs/hooks";
import { useTabs } from "../../state/tabs/store";
import { countUsage } from "../../state/telemetry/telemetry";
import { browseLayout, capsule, FloatingMenu, font, ink, LookFrost, radius, rolesFor, space, springs, Symbol, SURFACES_FROST, tabsCurve, tabsInk, tabsLayout, tabsMotion, trayMotion, trayShadow, useTheme, FadeView, fadeIsNative, ChromeSurface, floatingPanelLayout, useDesign, useReduceTransparency, useReduceMotion } from "../ui";
import { SuggestionRow } from "./SuggestionRow";
import { TrayInput, type TrayInputHandle } from "./TrayInput";
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
  countRender("TrayLayer");
  const origin = useSearchOrigin();
  const theme = useTrayTheme();
  const incognito = useIncognito();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const keyboard = useTrayKeyboard();
  const landing = useSharedValue(0);
  const depart = useSharedValue(0);
  const back = useSharedValue(0);
  const departing = useRef(false);
  const beginDeparture = () => {
    if (!panel || reduceMotion || departing.current) return;
    departing.current = true;
    runOnUI(() => {
      "worklet";
      if (heldLift.value < 0) heldLift.value = liveLift(keyboard.height.value, bottomNow.value, hasLanded.value, false);
    })();
    depart.value = withTiming(1, { duration: floatingPanelLayout.departMs, easing: tabsCurve.depart });
  };
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
  const panel = useDesign() === "redesigned";
  const reduceTransparency = useReduceTransparency();
  const trayHeight = trayMaxHeight(preferred, window.height - insets.top, Math.max(keyboard.target, safeBottom), space.s + (panel ? floatingPanelLayout.aboveKeyboard : 0));
  const extend = window.height;
  const closedOnPressIn = useRef(false);
  const closeFromTouch = () => {
    if (searchState().open && searchState().session === session) cancelSearch();
  };
  const closeOnPressIn = () => {
    closedOnPressIn.current = true;
    closeFromTouch();
  };
  const closeOnPress = () => {
    if (closedOnPressIn.current) {
      closedOnPressIn.current = false;
      return;
    }
    closeFromTouch();
  };

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

  const heightNow = useSharedValue(trayHeight);
  const bottomNow = useSharedValue(safeBottom);
  const reducedNow = useSharedValue(reduceMotion);
  useEffect(() => {
    heightNow.value = trayHeight;
    bottomNow.value = safeBottom;
    reducedNow.value = reduceMotion;
  }, [trayHeight, safeBottom, reduceMotion]);
  const settleRef = useRef(settleAfterDrag);
  settleRef.current = settleAfterDrag;
  const settleLatest = useCallback(() => settleRef.current(), []);

  const dismissDrag = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("trayDismissDrag")
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
            if (heldLift.value < 0) heldLift.value = liveLift(keyboard.height.value, bottomNow.value, hasLanded.value, isClosing.value);
            runOnJS(letKeyboardGo)();
          }
          drag.value = trayDragOffset(event.translationY);
        })
        .onEnd((event) => {
          dragging.value = false;
          if (trayDragDismisses(event.translationY, event.velocityY, heightNow.value)) {
            runOnJS(cancelSearch)();
            return;
          }
          drag.value = reducedNow.value ? withTiming(0, { duration: trayMotion.reduced, easing: tabsCurve.easeOut }) : withSpring(0, trayMotion.settle);
          runOnJS(settleLatest)();
        }),
    [closing],
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
    const departs = panel && !reduceMotion && searchState().ending === "submitted";
    if (departs) beginDeparture();
    putKeyboardAway();
    const followsKeyboard = keyboardIsUp(keyboard.height.value) && heldLift.value < 0;
    if (!departs) landing.value = followsKeyboard
      ? 0
      : reduceMotion
        ? withTiming(0, { duration: trayMotion.reduced, easing: tabsCurve.easeInOut })
        : withSpring(0, trayMotion.dismiss);
    let live = true;
    let stopWaiting = () => {};
    void (async () => {
      if (AppState.currentState === "background") {
        await new Promise<void>((resolve) => {
          const resumes = AppState.addEventListener("change", (next) => {
            if (next !== "active") return;
            resumes.remove();
            resolve();
          });
          stopWaiting = () => resumes.remove();
        });
        if (!live) return;
        putKeyboardAway();
      }
      for (let polls = 0; polls < TRAY_LIFT.closePolls && keyboardIsUp(keyboard.height.value); polls++) await wait(TRAY_LIFT.closePollMs);
      await wait(TRAY_LIFT.removalDelayMs);
      if (live) onClosed(generation);
    })();
    return () => {
      live = false;
      stopWaiting();
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
    () => !isClosing.value && (keyboardIsUp(keyboard.height.value) || hasLanded.value),
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
  const covered = useTrayCovers((state) => state.covers > 0);
  const voicePresented = useVoice((state) => state.presented);
  const trayOnTop = !closing && !covered && !voicePresented;
  useEffect(() => {
    if (!trayOnTop) return;
    const stop = followTrayBack({
      onProgress: (progress) => {
        back.value = progress;
      },
      onCancel: () => {
        back.value = withSpring(0, trayMotion.settle);
      },
      onCommit: () => {
        if (!useTabs.getState().incognito) countUsage("tray_back_swiped");
        cancelSearch();
      },
    });
    return () => {
      stop();
      back.value = withSpring(0, trayMotion.settle);
    };
  }, [trayOnTop]);
  const trayStyle = useAnimatedStyle(() => {
    const lift = currentLift();
    const rise = reduceMotion ? 1 : Math.max(landing.value, keyboardProgress(keyboard.height.value, keyboard.full.value, 0));
    return {
      opacity: (reduceMotion ? dim.value : 1) * (1 - depart.value),
      transform: [{ translateY: trayOffset(lift, drag.value, rise, trayHeight, panel ? floatingPanelLayout.radius : radius.sheet) - floatingPanelLayout.departLift * depart.value + back.value * trayBackTravel }],
    };
  }, [trayHeight, safeBottom, reduceMotion, panel]);

  return (
    <DepartContext.Provider value={beginDeparture}>
    <View style={StyleSheet.absoluteFill} pointerEvents={closing ? "none" : "box-none"}>
      <Animated.View testID="trayDim" style={[StyleSheet.absoluteFill, dimStyle]}>
        <Pressable
          accessibilityLabel="Close Search"
          accessibilityRole="button"
          onPressIn={closeOnPressIn}
          onPress={closeOnPress}
          style={[StyleSheet.absoluteFill, { backgroundColor: origin === "page" ? theme.trayDim : ink.clear }]}
        />
      </Animated.View>
      {panel ? (
        <Animated.View
          testID="trayPanel"
          style={[
            styles.panel,
            { height: trayHeight, boxShadow: incognito ? floatingPanelLayout.incognitoShadow : floatingPanelLayout.shadow },
            trayStyle,
          ]}
        >
          <ChromeSurface shape="rounded" cornerRadius={floatingPanelLayout.radius} interactive={false} tinted incognito={incognito} style={StyleSheet.absoluteFill} />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: floatingPanelLayout.radius,
                backgroundColor: incognito ? floatingPanelLayout.incognitoFill : theme.surface,
                opacity: reduceTransparency ? 1 : incognito ? floatingPanelLayout.incognitoShare : floatingPanelLayout.tintShare,
              },
            ]}
          />
          <View style={{ height: trayHeight, borderRadius: floatingPanelLayout.radius, overflow: "hidden" }}>
            <GestureDetector gesture={dismissDrag}>
              <View collapsable={false}>
                <TrayField key={session} closing={closing} />
              </View>
            </GestureDetector>
            <TrayRows dismissDrag={dismissDrag} />
          </View>
        </Animated.View>
      ) : (
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
              <TrayField key={session} closing={closing} />
            </View>
          </GestureDetector>
          <TrayRows dismissDrag={dismissDrag} />
        </View>
      </Animated.View>
      )}
    </View>
    </DepartContext.Provider>
  );
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const DepartContext = createContext<() => void>(() => undefined);

function useLeavingActions() {
  const depart = useContext(DepartContext);
  const departIfLeft = () => {
    const now = searchState();
    if (!now.open && now.ending === "submitted") depart();
  };
  return {
    submit: (text: string) => {
      const opened = submitSearch(text);
      if (opened) departIfLeft();
      return opened;
    },
    activate: (row: TrayRow) => {
      activateRow(row);
      departIfLeft();
    },
  };
}

const putKeyboardAway = () => {
  trayInput?.blur();
  Keyboard.dismiss();
};

const letKeyboardGo = () => putKeyboardAway();

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

let trayInput: TrayInputHandle | null = null;

const focusTray = () => trayInput?.focus();

const mayFocusTray = () => !useOnboarding.getState().showing && !useVoice.getState().presented;

function TrayField({ closing }: { closing: boolean }) {
  const version = useSearchFieldVersion();
  return <FieldInput key={version} first={version === 0} closing={closing} />;
}

function FieldInput({ first, closing }: { first: boolean; closing: boolean }) {
  const leaving = useLeavingActions();
  const theme = useTrayTheme();
  const panelField = useDesign() === "redesigned";
  const incognitoField = useIncognito();
  const initialText = useSearchInitialText();
  const [start] = useState(() => searchState().text);
  const [hasText, setHasText] = useState(start.length > 0);
  const input = useRef<TrayInputHandle | null>(null);
  const submitted = useRef(false);

  const [fieldGone, dropField] = useState(false);
  useEffect(() => {
    if (closing) {
      input.current?.blur();
      dropField(true);
      return;
    }
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, [closing]);
  const lastText = useRef(start);

  return (
    <View style={useDesign() === "redesigned" ? styles.panelFieldArea : styles.fieldArea}>
      <View style={[styles.field, panelField ? (theme.dark || incognitoField ? styles.panelFieldDark : styles.panelFieldLight) : { backgroundColor: theme.fieldFill, borderColor: theme.fieldStroke }]}>
        {fieldGone ? (
          <Text testID="trayFieldLeaving" numberOfLines={1} style={[font.title3, styles.input, styles.leavingText, { color: lastText.current ? theme.foregroundPrimary : theme.foregroundTertiary }]}>
            {lastText.current || "Search…"}
          </Text>
        ) : (
        <TrayInput
          ref={(field) => {
            input.current = field;
            trayInput = field;
          }}
          style={styles.input}
          start={start}
          selectsStart={first && Boolean(initialText)}
          color={theme.foregroundPrimary}
          placeholderColor={theme.foregroundTertiary}
          accent={theme.formAccent}
          onTyped={(text) => {
            lastText.current = text;
            if (text.length > 0 !== hasText) setHasText(text.length > 0);
            typeSearch(text);
          }}
          onSubmit={(text) => {
            if (submitted.current) return;
            if (leaving.submit(text)) submitted.current = true;
          }}
        />
        )}
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
  const leaving = useLeavingActions();
  const theme = useTrayTheme();
  const rows = useSearchRows();
  const typed = useSearchText();
  const incognito = useIncognito();
  const [room, setRoom] = useState(0);
  const [bottoms, setBottoms] = useState<number[]>([]);
  const refine = useCallback((row: TrayRow) => setSearchText(refinedText(row)), []);
  const [menu, setMenu] = useState<{ row: TrayRow; y: number } | null>(null);
  const menuOpen = menu !== null;
  useEffect(() => (menuOpen ? coverTray() : undefined), [menuOpen]);
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
      <Animated.View key="rows" testID="trayRows" entering={resultsIn} exiting={resultsOut} style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
        <ScrubbedRows rows={rows} typed={typed} budget={room} onMeasure={measure} onRefine={refine} onMenu={showMenu} />
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
            <SuggestionRow row={row} typed={typed} roles={theme} menu={trayRowActions(row)} onActivate={leaving.activate} onRefine={refine} onMenu={showMenu} />
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
  const leaving = useLeavingActions();
  const theme = useTrayTheme();
  const latest = useRef({ rows, budget });
  latest.current = { rows, budget };
  const measured = useRef<(RowFrame | null)[]>([]);
  const [, remeasured] = useState(0);
  const frames = useSharedValue<(RowFrame | null)[]>([]);
  const scrub = useSharedValue<ScrubState>(idleScrub);
  const menuTaken = useSharedValue(false);
  const drawn = useSharedValue(-1);
  const alpha = useSharedValue(0);
  useEffect(() => {
    measured.current = measured.current.slice(0, rows.length);
    frames.value = [...measured.current];
  }, [rows]);

  const release = (index: number) => {
    const row = latest.current.rows[index];
    if (!row) return;
    const frame = measured.current[index];
    if (frame && rowsOverflow(frame.bottom, latest.current.budget) && !useTabs.getState().incognito) countUsage("tray_hidden_rows_opened");
    haptics.confirm();
    leaving.activate(row);
  };
  const tick = () => haptics.selection();
  const openMenu = (row: TrayRow, y: number) => {
    menuTaken.value = true;
    scrub.value = idleScrub;
    onMenu(row, y);
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("trayRowsScrub")
        .maxPointers(1)
        .minDistance(SCRUB.distance)
        .onBegin((event) => {
          scrub.value = scrubBegin(frames.value, event.x, event.y);
          menuTaken.value = false;
        })
        .onUpdate((event) => {
          if (menuTaken.value) return;
          const moved = scrubMove(scrub.value, frames.value, event.x, event.y);
          scrub.value = moved.state;
          if (moved.ticks) runOnJS(tick)();
        })
        .onEnd((event) => {
          if (menuTaken.value) return;
          const ended = scrubEnd({ ...scrub.value, scrubbing: true }, frames.value, event.x, event.y);
          if (ended.kind === "activate") runOnJS(release)(ended.index);
        })
        .onFinalize(() => {
          scrub.value = idleScrub;
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

  const lastFrame = measured.current[rows.length - 1];
  const overflows = rowsOverflow(lastFrame?.bottom ?? 0, budget);
  const fadesNatively = overflows && fadeIsNative();
  return (
    <GestureDetector gesture={gesture}>
      <FadeView
        testID="trayRowList"
        bottom={fadesNatively ? rowsFadeEdge(budget) : undefined}
        style={[styles.rowsContent, { height: budget > 0 ? budget : undefined, overflow: "hidden" }]}
        collapsable={false}
      >
        <Animated.View pointerEvents="none" style={[styles.highlight, { backgroundColor: theme.rowHighlight }, highlightStyle]} />
        {rows.map((row, index) => (
          <View
            key={index}
            testID={`trayRow:${index}`}
            style={overflows && !fadesNatively && measured.current[index] ? { opacity: rowFade(measured.current[index]!.top, measured.current[index]!.bottom, budget, true) } : null}
            onLayout={(event) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              const was = measured.current[index];
              measured.current[index] = { left: x, top: y, right: x + width, bottom: y + height };
              frames.value = [...measured.current];
              if (!was || was.top !== y || was.bottom !== y + height) remeasured((count) => count + 1);
              onMeasure(index, event.nativeEvent.layout);
            }}
          >
            <SuggestionRow row={row} typed={typed} roles={theme} highlightsPress={false} menu={trayRowActions(row)} onActivate={leaving.activate} onRefine={onRefine} onMenu={openMenu} />
          </View>
        ))}
      </FadeView>
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
  panel: {
    position: "absolute",
    left: floatingPanelLayout.inset,
    right: floatingPanelLayout.inset,
    bottom: floatingPanelLayout.aboveKeyboard,
    borderRadius: floatingPanelLayout.radius,
    borderCurve: "continuous",
  },
  panelFieldLight: { backgroundColor: floatingPanelLayout.fieldLight.fill, borderColor: floatingPanelLayout.fieldLight.edge, borderWidth: floatingPanelLayout.fieldEdge },
  panelFieldDark: { backgroundColor: floatingPanelLayout.fieldDark.fill, borderColor: floatingPanelLayout.fieldDark.edge, borderWidth: floatingPanelLayout.fieldEdge },
  panelFieldArea: { paddingHorizontal: floatingPanelLayout.fieldInset, paddingTop: floatingPanelLayout.fieldInset, paddingBottom: floatingPanelLayout.fieldBottom },
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
  leavingText: { textAlignVertical: "center", lineHeight: browseLayout.searchFieldHeight },
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
