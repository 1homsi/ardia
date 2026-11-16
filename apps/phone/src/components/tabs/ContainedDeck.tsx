import { createContext, memo, useContext, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import { PixelRatio, Platform, StyleSheet, View } from "react-native";
import Animated, { makeMutable, useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { countRender } from "../../state/app/interactionPerf";
import { isUnseenReceived } from "../../lib/tabFace";
import { DECK_HEADER, deckBarBand, deckHeaderIconReveal, deckHeaderLeading, deckHeaderPlacement, deckSlot, deckStatusStrip, titleReveal, type DeckGeometry, type DeckSlots } from "../../lib/deckGeometry";
import { useHeldPageTone } from "../../state/browse/deckHold";
import { display } from "../../state/search/omnibox";
import { shownTone } from "../../lib/pageTone";
import { snapshotPageTop } from "../../lib/shownSnapshots";
import { barHeight, FadeView, font, screenReaderActions, TabFace, tabsInk, tabsLayout, useDesign, usePageUnderBars, useTheme, isDarkColor } from "../ui";
import { nativeMenus } from "../ui/MenuTrigger";
import { isLabBuild } from "../../platform/lab";
import { launchArguments } from "../../state/app/launchFlags";
import { CardIcon, cardPose, DeckCard, DeckCardMenu, deckCardStyles, deckRole, EXPANDED_Z, ReceivedBadge, sameCard, type DeckMotion } from "./DeckCard";

export const containedDeckScroll = (): boolean => Platform.OS === "android" && isLabBuild && launchArguments().oneContainerScroll;

type CardLook = { y: number; scale: number; opacity: number; corner: number };
type ReachLook = { x: number; y: number; scaleX: number; scaleY: number };
type HeaderLook = { x: number; y: number; opacity: number };

export type ContainedPlacement = { layer: number; slot: number; card: CardLook; reach: ReachLook; header: HeaderLook; available: number; expanded: boolean };

export type ContainedInputs = {
  ids: readonly string[];
  scroll: number;
  phase: number;
  expanded: number;
  scaleProgress: number;
  positionProgress: number;
  dragIndex: number;
  dragLift: number;
  flyIndex: number;
  flyLift: number;
  flyVanish: number;
  covering: string;
  fromSlots: DeckSlots;
  shiftBy: number;
  gap: number;
};

type CardFeed = {
  layer: SharedValue<number>;
  slot: SharedValue<number>;
  card: SharedValue<CardLook>;
  reach: SharedValue<ReachLook>;
  header: SharedValue<HeaderLook>;
  available: SharedValue<number>;
  expanded: SharedValue<boolean>;
  gone: SharedValue<boolean>;
};

type Feeds = Record<string, CardFeed>;

export function devicePixel(value: number, ratio: number): number {
  "worklet";
  return Math.round(value * ratio) / ratio;
}

export function opacityStep(value: number): number {
  "worklet";
  return Math.round(value * 255) / 255;
}

export function containedOffset(g: DeckGeometry, scroll: number, ratio: number): number {
  "worklet";
  return devicePixel(-g.spacing * scroll, ratio);
}

export function containedPlacement(g: DeckGeometry, ratio: number, now: ContainedInputs, index: number, gone: boolean, id: string): ContainedPlacement {
  "worklet";
  const listed = index >= 0;
  const role = deckRole(now.phase, now.expanded, index);
  const flying = listed && now.flyIndex === index;
  const lift = listed && now.dragIndex === index ? now.dragLift : flying ? now.flyLift : 0;
  const slotAt = listed ? deckSlot(id, index, now.fromSlots, now.shiftBy, now.gap) : 0;
  const relative = slotAt - now.scroll;
  const p = cardPose(g, role, relative, now.scaleProgress, now.positionProgress, lift, flying ? now.flyVanish : gone || !listed ? 1 : 0, index === now.ids.length - 1);
  const exact = role !== "stay";
  const fit = (value: number) => (exact ? value : devicePixel(value, ratio));
  const shade = (value: number) => (exact ? value : opacityStep(value));
  const shift = g.spacing * now.scroll;
  const left = p.x - g.cardWidth / 2;
  const slot = !exact && relative >= 0 ? devicePixel(left + shift, ratio) : fit(left) - containedOffset(g, now.scroll, ratio);
  const cardLeft = p.x - (g.cardWidth * p.scale) / 2;
  const top = p.y - (g.cardHeight * p.scale) / 2;
  const place = deckHeaderPlacement(cardLeft, p.visible);
  const available = fit(place.available);
  return {
    layer: Math.max(index, 0) * 2 + (role === "expanded" ? EXPANDED_Z : 0),
    slot,
    card: { y: fit(p.y - g.cardHeight / 2), scale: p.scale, opacity: now.covering === id ? 0 : shade(p.opacity), corner: p.corner / Math.max(p.scale, 0.01) },
    reach: { x: fit(cardLeft - left), y: fit(top), scaleX: Math.max(1, fit(p.visible * p.scale)) / g.cardWidth, scaleY: p.scale },
    header: { x: fit(place.left + place.available - g.cardWidth - left), y: fit(top - tabsLayout.headerGap - tabsLayout.headerHeight), opacity: shade(p.header * deckHeaderIconReveal(available, tabsLayout.faviconSize)) },
    available,
    expanded: role === "expanded",
  };
}

function readInputs(motion: DeckMotion): ContainedInputs {
  return {
    ids: motion.orderIds.value,
    scroll: motion.scroll.value,
    phase: motion.phase.value,
    expanded: motion.expandedIndex.value,
    scaleProgress: motion.scaleProgress.value,
    positionProgress: motion.positionProgress.value,
    dragIndex: motion.dragIndex.value,
    dragLift: motion.dragLift.value,
    flyIndex: motion.flyIndex.value,
    flyLift: motion.flyLift.value,
    flyVanish: motion.flyVanish.value,
    covering: motion.covering.value,
    fromSlots: motion.fromSlots.value,
    shiftBy: motion.shiftBy.value,
    gap: motion.gap.value,
  };
}

function makeFeed(placed: ContainedPlacement): CardFeed {
  return {
    layer: makeMutable(placed.layer),
    slot: makeMutable(placed.slot),
    card: makeMutable(placed.card),
    reach: makeMutable(placed.reach),
    header: makeMutable(placed.header),
    available: makeMutable(placed.available),
    expanded: makeMutable(placed.expanded),
    gone: makeMutable(false),
  };
}

const FeedsContext = createContext<Feeds>({});

type ContainedCardsProps = { ids: readonly string[]; geometry: DeckGeometry; motion: DeckMotion; children: ReactNode };

export function containedCards(on: boolean, props: Omit<ContainedCardsProps, "children">, cards: ReactNode): ReactNode {
  return on ? <ContainedCards {...props}>{cards}</ContainedCards> : cards;
}

function ContainedCards({ ids, geometry: g, motion, children }: ContainedCardsProps) {
  const ratio = PixelRatio.get();
  const made = useRef<Map<string, CardFeed>>(new Map());
  const feeds = useMemo(() => {
    const now = readInputs(motion);
    const at = new Map(now.ids.map((id, index) => [id, index]));
    const next: Feeds = {};
    for (const id of ids) next[id] = made.current.get(id) ?? makeFeed(containedPlacement(g, ratio, now, at.get(id) ?? -1, false, id));
    made.current = new Map(Object.entries(next));
    return next;
  }, [ids]);
  const cardIds = useMemo(() => Object.keys(feeds), [feeds]);
  const { orderIds, scroll, phase, expandedIndex, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish, covering, fromSlots, shiftBy, gap } = motion;
  useAnimatedReaction(
    (): ContainedInputs => ({
      ids: orderIds.value,
      scroll: scroll.value,
      phase: phase.value,
      expanded: expandedIndex.value,
      scaleProgress: scaleProgress.value,
      positionProgress: positionProgress.value,
      dragIndex: dragIndex.value,
      dragLift: dragLift.value,
      flyIndex: flyIndex.value,
      flyLift: flyLift.value,
      flyVanish: flyVanish.value,
      covering: covering.value,
      fromSlots: fromSlots.value,
      shiftBy: shiftBy.value,
      gap: gap.value,
    }),
    (now) => {
      const at: Record<string, number> = {};
      for (let i = 0; i < now.ids.length; i++) at[now.ids[i]!] = i;
      for (let c = 0; c < cardIds.length; c++) {
        const id = cardIds[c]!;
        const feed = feeds[id]!;
        const index = at[id] ?? -1;
        if (index >= 0 && now.flyIndex === index && now.flyVanish >= 1 && !feed.gone.value) feed.gone.value = true;
        const next = containedPlacement(g, ratio, now, index, feed.gone.value, id);
        if (feed.layer.value !== next.layer) feed.layer.value = next.layer;
        if (feed.slot.value !== next.slot) feed.slot.value = next.slot;
        const card = feed.card.value;
        if (card.y !== next.card.y || card.scale !== next.card.scale || card.opacity !== next.card.opacity || card.corner !== next.card.corner) feed.card.value = next.card;
        const reach = feed.reach.value;
        if (reach.x !== next.reach.x || reach.y !== next.reach.y || reach.scaleX !== next.reach.scaleX || reach.scaleY !== next.reach.scaleY) feed.reach.value = next.reach;
        const header = feed.header.value;
        if (header.x !== next.header.x || header.y !== next.header.y || header.opacity !== next.header.opacity) feed.header.value = next.header;
        if (feed.available.value !== next.available) feed.available.value = next.available;
        if (feed.expanded.value !== next.expanded) feed.expanded.value = next.expanded;
      }
    },
    [feeds, cardIds, g, ratio],
  );
  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: containedOffset(g, scroll.value, ratio) }] }), [g, ratio]);
  return (
    <Animated.View testID="deckScrollContainer" pointerEvents="box-none" collapsable={false} style={[styles.container, { width: g.width + g.spacing * Math.max(ids.length, 1) + g.cardWidth, height: g.height }, containerStyle]}>
      <FeedsContext.Provider value={feeds}>{children}</FeedsContext.Provider>
    </Animated.View>
  );
}

export const ContainedDeckCard = memo(function ContainedDeckCard({ tab, index, geometry: g, motion, onOpen, onClose, onCloseNow }: ComponentProps<typeof DeckCard>) {
  countRender("DeckCard");
  const theme = useTheme();
  const design = useDesign();
  const tone = shownTone(useHeldPageTone(tab.id), tab.themeColorHex);
  const { layer, slot, card, reach, header, available, expanded } = useContext(FeedsContext)[tab.id]!;
  const { scaleProgress } = motion;
  const ratio = PixelRatio.get();
  const layerStyle = useAnimatedStyle(() => ({ zIndex: layer.value }));
  const slotStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slot.value }] }));
  const cardStyle = useAnimatedStyle(() => {
    const c = card.value;
    return { opacity: c.opacity, borderRadius: c.corner, transform: [{ translateY: c.y }, { scale: c.scale }] };
  });
  const reachStyle = useAnimatedStyle(() => {
    const r = reach.value;
    return { transform: [{ translateX: r.x }, { translateY: r.y }, { scaleX: r.scaleX }, { scaleY: r.scaleY }] };
  });
  const headerStyle = useAnimatedStyle(() => {
    const h = header.value;
    return { opacity: h.opacity, transform: [{ translateX: h.x }, { translateY: h.y }] };
  });
  const titleWidth = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => {
    const room = available.value;
    return { transform: [{ translateX: devicePixel(g.cardWidth - room + deckHeaderLeading(room, tabsLayout.faviconSize, tabsLayout.headerSpacing, titleWidth.value, titleReveal(room)), ratio) }] };
  }, [g, ratio]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: opacityStep(titleReveal(available.value)) }));
  const underBars = usePageUnderBars();
  const pageTop = (tab.snapshotFileName ? snapshotPageTop(tab.snapshotFileName) : null) ?? (underBars ? 0 : g.safeTop);
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: expanded.value ? deckStatusStrip(g, scaleProgress.value, pageTop) : 0 }] }), [g, pageTop]);
  const bar = deckBarBand(g, barHeight(g.safeBottom), 1);
  const bandStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: expanded.value && !underBars ? deckBarBand(g, 0, scaleProgress.value).grown : 0 }] }), [g, underBars]);

  const host = display(tab.url).host;
  const title = tab.title || host || "New Tab";
  const cardContents = (
    <>
      <Animated.View testID="deckCardFace" style={[StyleSheet.absoluteFill, faceStyle]}>
        <TabFace tab={tab} title={title} host={host} tone={tone.top} roles={theme} paintedAs={`deck:${tab.id}`} />
      </Animated.View>
      <Animated.View testID="deckCardBarBand" pointerEvents="none" style={[deckCardStyles.band, { height: bar.height, backgroundColor: tone.bottom ?? theme.surface }, bandStyle]}>
        {design === "original" ? <View testID="deckCardBarShade" style={[StyleSheet.absoluteFill, { backgroundColor: isDarkColor(tone.bottom ?? theme.surface) ? tabsInk.barShadeOnDark : tabsInk.barShadeOnLight }]} /> : null}
      </Animated.View>
      {isUnseenReceived(tab) ? <ReceivedBadge /> : null}
    </>
  );
  return (
    <Animated.View testID="deckCardLayer" pointerEvents="box-none" collapsable={false} style={[StyleSheet.absoluteFill, layerStyle]}>
      <Animated.View testID="deckCardSlot" pointerEvents="box-none" collapsable={false} style={[StyleSheet.absoluteFill, slotStyle]}>
        <Animated.View
          testID="deckCard"
          needsOffscreenAlphaCompositing
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[deckCardStyles.card, { width: g.cardWidth, height: g.cardHeight, borderColor: theme.cardEdge, backgroundColor: tone.top ?? theme.surface }, cardStyle]}
        >
          {nativeMenus() ? (
            <DeckCardMenu tab={tab} index={index} onClose={onClose} fill={tone.top ?? theme.surface}>
              {cardContents}
            </DeckCardMenu>
          ) : (
            cardContents
          )}
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
          style={[deckCardStyles.reach, { width: g.cardWidth, height: g.cardHeight }, reachStyle]}
        />
        <Animated.View style={[deckCardStyles.header, { width: g.cardWidth }, headerStyle]} pointerEvents="none">
          <FadeView testID="deckHeaderFade" trailing={{ length: DECK_HEADER.trailingFade }} style={StyleSheet.absoluteFill}>
            <Animated.View style={[deckCardStyles.headerRow, rowStyle]}>
              <CardIcon tab={tab} />
              <Animated.Text
                testID="deckHeaderTitle"
                maxFontSizeMultiplier={DECK_HEADER.maxFontScale}
                onLayout={(event) => {
                  titleWidth.value = event.nativeEvent.layout.width;
                }}
                style={[font.caption, deckCardStyles.title, { color: theme.headerText }, titleStyle]}
                numberOfLines={1}
              >
                {title}
              </Animated.Text>
            </Animated.View>
          </FadeView>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}, sameCard);

const styles = StyleSheet.create({
  container: { position: "absolute", left: 0, top: 0 },
});
