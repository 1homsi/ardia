import { memo, useEffect, useRef } from "react";
import { countRender } from "../../state/app/interactionPerf";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { isUnseenReceived } from "../../lib/tabFace";
import { DECK, DECK_HEADER, deckBarBand, deckHeaderIconReveal, deckStatusStrip, deckHeaderLeading, deckHeaderPlacement, deckLeading, deckVisibleWidth, lerp, titleReveal, type DeckGeometry } from "../../lib/deckGeometry";
import { usePageTone } from "../../state/browse/hooks";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { shownTone } from "../../lib/pageTone";
import { snapshotPageTop } from "../../lib/shownSnapshots";
import { barHeight, FadeView, Favicon, font, screenReaderActions, space, Symbol, TabFace, tabsInk, tabsLayout, tabsMotion, useTheme } from "../ui";

export type DeckRole = "stay" | "expanded" | "launcher" | "slideLeft" | "slideRight";

const UNSHOWN_TAB_FIELDS = new Set<keyof BrowserTab>(["lastActive"]);

function sameCardTab(a: BrowserTab, b: BrowserTab): boolean {
  if (a === b) return true;
  for (const key of Object.keys(a) as (keyof BrowserTab)[]) if (!UNSHOWN_TAB_FIELDS.has(key) && a[key] !== b[key]) return false;
  return Object.keys(a).length === Object.keys(b).length;
}

function sameCard(a: Props, b: Props): boolean {
  for (const key of Object.keys(a) as (keyof Props)[]) {
    if (key === "tab" ? !sameCardTab(a.tab, b.tab) : a[key] !== b[key]) return false;
  }
  return true;
}

export const DECK_PHASE = { settled: 0, opening: 1, closing: 2 } as const;

export function deckRole(phase: number, expanded: number, index: number): DeckRole {
  "worklet";
  if (phase === DECK_PHASE.settled || expanded < 0) return "stay";
  if (index === expanded) return "expanded";
  if (phase === DECK_PHASE.opening) return index < expanded ? "launcher" : "slideRight";
  return index < expanded ? "slideLeft" : "slideRight";
}

const EXPANDED_Z = 100_000;

export type DeckMotion = {
  phase: SharedValue<number>;
  expandedIndex: SharedValue<number>;
  scroll: SharedValue<number>;
  scaleProgress: SharedValue<number>;
  positionProgress: SharedValue<number>;
  dragIndex: SharedValue<number>;
  dragLift: SharedValue<number>;
  flyIndex: SharedValue<number>;
  flyLift: SharedValue<number>;
  flyVanish: SharedValue<number>;
};

type Props = {
  tab: BrowserTab;
  index: number;
  isLast: boolean;
  geometry: DeckGeometry;
  motion: DeckMotion;
  shift: { by: number; generation: number };
  onOpen: (index: number) => void;
  onClose: (index: number) => void;
  onCloseNow: (index: number) => void;
};

type Pose = { x: number; y: number; scale: number; corner: number; opacity: number; header: number; visible: number; lift: number };

function cardPose(g: DeckGeometry, role: DeckRole, relative: number, sp: number, pp: number, lift: number, vanish: number, isLast: boolean): Pose {
  "worklet";
  const cx = deckLeading(g, relative) + g.cardWidth / 2;
  const cy = g.cardCenterY;
  let x = cx;
  let y = cy;
  let scale = 1;
  let corner: number = DECK.cardRadius;
  let opacity = 1;
  if (role === "expanded") {
    scale = lerp(g.width / Math.max(g.cardWidth, 1), 1, sp);
    x = lerp(g.width / 2, cx, pp);
    y = lerp(g.height / 2, cy, pp);
    corner = lerp(DECK.displayCornerRadius, DECK.cardRadius, sp);
  } else if (role === "launcher") {
    scale = lerp(DECK.launcherStartWidth / Math.max(g.cardWidth, 1), 1, sp);
    x = lerp(g.tabButtonX, cx, pp);
    y = lerp(g.barCenterY, cy, pp);
    corner = lerp(DECK.launcherStartRadius, DECK.cardRadius, sp);
    opacity = Math.min(1, sp * 2.5);
  } else if (role === "slideLeft") {
    x -= (1 - pp) * g.width * 0.7;
  } else if (role === "slideRight") {
    x += (1 - pp) * g.width;
  }
  const fade = Math.min(Math.max(vanish, 0), 1);
  y += lift;
  scale *= 1 - 0.28 * fade;
  opacity *= 1 - fade;
  const settle = role === "stay" ? 1 : Math.max(0, (pp - 0.7) / 0.3);
  const liftFade = Math.max(0, 1 + lift / 120);
  return { x, y, scale, corner, opacity, header: Math.min(1, settle) * Math.min(1, liftFade) * (1 - fade), visible: deckVisibleWidth(g, relative, isLast), lift };
}

export const DeckCard = memo(function DeckCard({ tab, index, isLast, geometry: g, motion, shift, onOpen, onCloseNow }: Props) {
  countRender("DeckCard");
  const theme = useTheme();
  const tone = shownTone(usePageTone(tab.id), tab.themeColorHex);
  const slot = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const shown = useRef(index);
  useEffect(() => {
    const by = shown.current - index + shift.by;
    shown.current = index;
    if (Math.abs(by) < 0.001) return;
    slot.value = by;
    slot.value = reduceMotion ? withTiming(0, { duration: tabsMotion.fade }) : withSpring(0, tabsMotion.gapClose);
  }, [index, shift.generation, shift.by, slot]);

  const { phase, expandedIndex, scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish } = motion;

  const placed = useDerivedValue(() => {
    const role = deckRole(phase.value, expandedIndex.value, index);
    const flying = flyIndex.value === index;
    const lift = dragIndex.value === index ? dragLift.value : flying ? flyLift.value : 0;
    const p = cardPose(g, role, index + slot.value - scroll.value, scaleProgress.value, positionProgress.value, lift, flying ? flyVanish.value : 0, isLast);
    const top = p.y - (g.cardHeight * p.scale) / 2 - tabsLayout.headerGap - tabsLayout.headerHeight;
    return { pose: p, top, place: deckHeaderPlacement(p.x - (g.cardWidth * p.scale) / 2, p.visible), z: index * 2 + (role === "expanded" ? EXPANDED_Z : 0), expanded: role === "expanded" };
  }, [g, index, isLast]);
  const cardStyle = useAnimatedStyle(() => {
    const p = placed.value.pose;
    return {
      zIndex: placed.value.z,
      opacity: p.opacity,
      borderRadius: p.corner / Math.max(p.scale, 0.01),
      transform: [{ translateX: p.x - g.cardWidth / 2 }, { translateY: p.y - g.cardHeight / 2 }, { scale: p.scale }],
    };
  }, [g]);
  const titleWidth = useSharedValue(0);
  const headerStyle = useAnimatedStyle(() => {
    const { pose: p, top, place } = placed.value;
    return {
      zIndex: placed.value.z + 1,
      opacity: p.header * deckHeaderIconReveal(place.available, tabsLayout.faviconSize),
      transform: [{ translateX: place.left + place.available - g.cardWidth }, { translateY: top }],
    };
  });
  const reachStyle = useAnimatedStyle(() => {
    const p = placed.value.pose;
    return {
      zIndex: placed.value.z + 1,
      transform: [
        { translateX: p.x - (g.cardWidth * p.scale) / 2 },
        { translateY: p.y - (g.cardHeight * p.scale) / 2 },
        { scaleX: Math.max(1, p.visible * p.scale) / g.cardWidth },
        { scaleY: p.scale },
      ],
    };
  }, [g]);
  const rowStyle = useAnimatedStyle(() => {
    const available = placed.value.place.available;
    return { transform: [{ translateX: g.cardWidth - available + deckHeaderLeading(available, tabsLayout.faviconSize, tabsLayout.headerSpacing, titleWidth.value, titleReveal(available)) }] };
  });
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleReveal(placed.value.place.available) }));
  const pageTop = (tab.snapshotFileName ? snapshotPageTop(tab.snapshotFileName) : null) ?? g.safeTop;
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: placed.value.expanded ? deckStatusStrip(g, scaleProgress.value, pageTop) : 0 }] }), [g, pageTop]);
  const bar = deckBarBand(g, barHeight(g.safeBottom), 1);
  const bandStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: placed.value.expanded ? deckBarBand(g, 0, scaleProgress.value).grown : 0 }] }), [g]);

  const host = display(tab.url).host;
  const title = tab.title || host || "New Tab";
  return (
    <>
      <Animated.View
        testID="deckCard"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.card,
          { width: g.cardWidth, height: g.cardHeight, borderColor: theme.cardEdge, backgroundColor: tone.top ?? theme.surface },
          cardStyle,
        ]}
      >
        <Animated.View testID="deckCardFace" style={[StyleSheet.absoluteFill, faceStyle]}>
          <TabFace tab={tab} title={title} host={host} tone={tone.top} roles={theme} />
        </Animated.View>
        <Animated.View testID="deckCardBarBand" pointerEvents="none" style={[styles.band, { height: bar.height, backgroundColor: tone.bottom ?? theme.surface }, bandStyle]} />
        {isUnseenReceived(tab) ? <ReceivedBadge /> : null}
      </Animated.View>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: tab.isPrivate ? `Incognito, ${host}` : host }}
        accessibilityHint="Opens the tab."
        {...screenReaderActions([
          { name: "activate", run: () => onOpen(index) },
          { name: "close", label: "Close Tab", run: () => onCloseNow(index) },
        ])}
        pointerEvents="none"
        style={[styles.reach, { width: g.cardWidth, height: g.cardHeight }, reachStyle]}
      />
      <Animated.View style={[styles.header, { width: g.cardWidth }, headerStyle]} pointerEvents="none">
        <FadeView testID="deckHeaderFade" trailing={{ length: DECK_HEADER.trailingFade }} style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.headerRow, rowStyle]}>
            {tab.isPrivate ? (
              <View style={[styles.privateIcon, { backgroundColor: tabsInk.incognitoCardRaised }]}>
                <Symbol name="eyes" size={tabsLayout.faviconSize - 4} color={tabsInk.onDark} />
              </View>
            ) : (
              <Favicon iconUrl={tab.faviconUrl} pageUrl={tab.url} size={tabsLayout.faviconSize} />
            )}
            <Animated.Text
              testID="deckHeaderTitle"
              maxFontSizeMultiplier={DECK_HEADER.maxFontScale}
              onLayout={(event) => {
                titleWidth.value = event.nativeEvent.layout.width;
              }}
              style={[font.caption, styles.title, { color: theme.headerText }, titleStyle]}
              numberOfLines={1}
            >
              {title}
            </Animated.Text>
          </Animated.View>
        </FadeView>
      </Animated.View>
    </>
  );
}, sameCard);

const CARD_ELEVATION = 14;
const HEADER_ROW_ROOM = 2000;
const CARD_SHADOW_BLUR = 36;
const RECEIVED_INSET = 10;

function ReceivedBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.formAccent, boxShadow: `0px 2px 12px ${theme.formAccent}59` }]}>
      <Symbol name="laptop" size={12} color={tabsInk.onDark} />
      <Text style={[styles.badgeText, { color: tabsInk.onDark }]}>From Your Mac</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({ android: { elevation: CARD_ELEVATION, shadowColor: tabsInk.cardShadow }, default: { boxShadow: `-2px 4px ${CARD_SHADOW_BLUR}px ${tabsInk.cardShadow}` } }),
  },
  band: { position: "absolute", left: 0, right: 0, bottom: 0, transformOrigin: "bottom" },
  badge: {
    position: "absolute",
    top: RECEIVED_INSET,
    left: RECEIVED_INSET,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.s,
    paddingVertical: space.xs,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: "600" },
  reach: { position: "absolute", left: 0, top: 0, transformOrigin: "left top" },
  header: { position: "absolute", left: 0, top: 0, height: tabsLayout.headerHeight, overflow: "hidden" },
  headerRow: { position: "absolute", left: 0, top: 0, width: HEADER_ROW_ROOM, flexDirection: "row", alignItems: "center", gap: tabsLayout.headerSpacing, height: tabsLayout.headerHeight },
  title: { fontWeight: "500" },
  privateIcon: { width: tabsLayout.faviconSize, height: tabsLayout.faviconSize, borderRadius: tabsLayout.faviconRadius, alignItems: "center", justifyContent: "center" },
});
