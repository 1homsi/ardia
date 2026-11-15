import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeckLookProbe } from "./DeckLookProbe";
import { useSheet, useSurface } from "../../state/browse/hooks";
import { useSearchOpen } from "../../state/search/hooks";
import { beginInteraction, countRender, INTERACTION_WINDOW_MS, interactionPerfEnabled } from "../../state/app/interactionPerf";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, runOnUI, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { POOF, poofCentreY } from "../../lib/poof";
import { PoofBurst, type PoofSpec } from "./PoofBurst";
import { haptics } from "../../state/app/haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { measuredOr, useRootSize } from "../../state/app/rootSize";
import {
  deckCardAt,
  deckGeometry,
  archiveCardEdgeY,
  deckScrollActionTarget,
  deckLeading,
  deckIsTap,
  deckDragKind,
  deckLift,
  deckScrollDuringDrag,
  deckSettleTarget,
  deckSettleVelocity,
  deckShouldClose,
  focusedIndex,
  initialDeckScroll,
  openingDeckScroll,
  scrollAfterClosing,
  scrollAfterRemoving,
} from "../../lib/deckGeometry";
import {
  beginOpeningTab,
  closeAllFromDeck,
  closeTabFromDeck,
  consumeDeckEntrance,
  leaveIncognito,
  newIncognitoTab,
  newRegularTab,
  newTab,
  openArchive,
  openSpaces,
  openTab,
  reopenLastClosed,
  stopOpeningTab,
  whenPageLaidOut,
} from "../../state/browse/store";
import { canShareTab, copyTabLink, menuOpenedHaptic, shareTab } from "../../state/browse/tabMenus";
import { useCanReopen, useDeckOrder, useHasArchivedTabs, useIncognito, usePrivateCount } from "../../state/tabs/hooks";
import { archiveCardLayout, ConfirmDialog, DeckLookBackdrop, DeckLookBackdropBase, FrostSource, Menu, ScrollActions, Shade, space, tabsCurve, tabsLayout, tabsMotion, type Confirmation, type MenuItem } from "../ui";
import { openSettings } from "../../state/settings/hooks";
import { useSyncEnabled } from "../../state/sync/hooks";
import { pinToMac, sendTab, sendTargetsFor } from "../../state/sync/actions";
import { currentTabs } from "../../state/tabs/store";
import { DeckBar } from "./DeckBar";
import { DECK_PHASE, DeckCard, type DeckMotion } from "./DeckCard";
import { hideArchiveCard, offerArchiveCard, showArchiveCardNow, useArchiveCardShowing } from "../../state/browse/archiveCard";
import { takeDeckCommand, useDeckCommand } from "../../state/browse/deckCommands";
import { ArchiveIntervalCard } from "./ArchiveIntervalCard";
import { DeckEmpty, IncognitoChip } from "./DeckChrome";

type Phase = { kind: "opening" | "settled" | "closing"; id: string | null };

export function TabDeck() {
  countRender("TabDeck");
  const measuresInteractions = interactionPerfEnabled();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const root = useRootSize();
  const { width, height } = measuredOr(root, window);
  const g = useMemo(() => deckGeometry(width, height, insets.top, insets.bottom, 0, Platform.OS), [width, height, insets.top, insets.bottom]);
  const [deckHeight, setDeckHeight] = useState<number | null>(null);
  const live = useDeckOrder();
  const incognito = useIncognito();
  const privateCount = usePrivateCount();
  const canReopen = useCanReopen();
  const hasArchive = useHasArchivedTabs();
  const syncEnabled = useSyncEnabled();
  const [order, setOrder] = useState<string[]>(() => live.map((t) => t.id));
  const [phase, setPhase] = useState<Phase>({ kind: "settled", id: null });
  const [menu, setMenu] = useState<"plus" | "chip" | null>(null);
  const [cardMenu, setCardMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const deckSurface = useSurface();
  const deckSheet = useSheet();
  const trayOpen = useSearchOpen();
  const probeTouch = useRef<(touching: boolean) => void>(() => undefined);
  const touchChanged = useCallback((on: boolean) => probeTouch.current(on), []);
  const archiveCard = useArchiveCardShowing();
  const offered = useRef(false);
  useEffect(() => {
    if (phase.kind !== "settled" || offered.current) return;
    offered.current = true;
    offerArchiveCard(order.length);
  }, [phase.kind]);
  useEffect(() => () => void hideArchiveCard(), []);
  const hidden = useRef(new Set<string>());
  const deckPhase = useSharedValue<number>(DECK_PHASE.settled);
  const expandedIndex = useSharedValue(-1);
  const enterPhase = (next: Phase, at: readonly string[] = order) => {
    deckPhase.value = DECK_PHASE[next.kind];
    expandedIndex.value = next.id ? at.indexOf(next.id) : -1;
    setPhase(next);
  };
  const settlePhase = () => {
    "worklet";
    deckPhase.value = DECK_PHASE.settled;
    expandedIndex.value = -1;
  };
  const scroll = useSharedValue(initialDeckScroll(order.length));
  const scaleProgress = useSharedValue(1);
  const positionProgress = useSharedValue(1);
  const dragIndex = useSharedValue(-1);
  const dragLift = useSharedValue(0);
  const flyIndex = useSharedValue(-1);
  const flyLift = useSharedValue(0);
  const flyVanish = useSharedValue(0);
  const orderIds = useSharedValue<readonly string[]>(order);
  const shiftBy = useSharedValue(0);
  const motion = useMemo<DeckMotion>(
    () => ({ orderIds, shiftBy, phase: deckPhase, expandedIndex, scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish }),
    [orderIds, shiftBy, deckPhase, expandedIndex, scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish],
  );
  const tabs = useMemo(() => new Map(live.map((t) => [t.id, t])), [live]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, positionProgress.value * BACKDROP_LEAD) }));
  const cardsOpacity = useSharedValue(1);
  const cardsStyle = useAnimatedStyle(() => ({ opacity: cardsOpacity.value }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, (positionProgress.value - CHROME_FROM) / (1 - CHROME_FROM)) }));
  const chipStyle = useAnimatedStyle(() => ({ opacity: dragIndex.value >= 0 ? 0 : Math.max(0, (positionProgress.value - CHROME_FROM) / (1 - CHROME_FROM)) }));

  const reduceMotion = useReducedMotion();
  const [poofs, setPoofs] = useState<PoofSpec[]>([]);
  const poofSeed = useRef(0);
  useEffect(() => {
    const entrance = consumeDeckEntrance();
    const index = entrance ? order.indexOf(entrance) : -1;
    if (index < 0) {
      cardsOpacity.value = 0;
      cardsOpacity.value = withTiming(1, { duration: tabsMotion.fade });
      return;
    }
    scroll.value = openingDeckScroll(index, order.length);
    setAnchor(Math.round(scroll.value));
    beginInteraction("deck open", INTERACTION_WINDOW_MS.deckOpen);
    enterPhase({ kind: "opening", id: entrance });
    scaleProgress.value = 0;
    positionProgress.value = 0;
    scaleProgress.value = withSpring(1, tabsMotion.openScale);
    positionProgress.value = withSpring(1, tabsMotion.openPosition, (finished) => {
      if (!finished) return;
      settlePhase();
      runOnJS(setPhase)({ kind: "settled", id: null });
    });
  }, []);

  useEffect(() => {
    const ids = live.map((t) => t.id);
    const alive = new Set(ids);
    const kept = order.filter((id) => alive.has(id));
    const known = new Set(kept);
    const next = [...kept, ...ids.filter((id) => !known.has(id))];
    if (next.length === order.length && next.every((id, i) => id === order[i])) return;
    const before = scroll.value;
    const focused = order[focusedIndex(before, order.length)];
    const stays = focused ? next.indexOf(focused) : -1;
    const removedAt = focused ? order.indexOf(focused) : 0;
    const onlyTail = next.length < order.length && next.every((id, i) => id === order[i]);
    const after = scrollAfterClosing(stays >= 0 ? stays : scrollAfterRemoving(removedAt, Math.round(before), next.length), next.length, onlyTail);
    for (const id of hidden.current) if (!alive.has(id)) hidden.current.delete(id);
    const expanded = phase.id ? next.indexOf(phase.id) : -1;
    runOnUI((ids: readonly string[], to: number, by: number, expandedAt: number, keepsExpanded: boolean) => {
      "worklet";
      flyIndex.value = -1;
      flyVanish.value = 0;
      flyLift.value = 0;
      shiftBy.value = by;
      if (keepsExpanded) expandedIndex.value = expandedAt;
      orderIds.value = ids;
      scroll.value = to;
    })(next, after, after - before, expanded, phase.id !== null);
    setAnchor(Math.round(after));
    setOrder(next);
  }, [live]);

  const settledOpen = (id: string) => openTab(id);

  const command = useDeckCommand((s) => s.command);
  useEffect(() => {
    if (!command || phase.kind !== "settled") return;
    takeDeckCommand(command.id);
    const focused = focusedIndex(scroll.value, order.length);
    if (command.kind === "scroll") {
      const target = Math.min(Math.max(command.index, 0), Math.max(order.length - 1, 0));
      setAnchor(target);
      scroll.value = withSpring(target, tabsMotion.settle);
    }
    else if (command.kind === "closeFocused") close(focused, 0);
    else if (command.kind === "openFocused") open(focused);
    else if (command.kind === "openSelected") {
      const selected = currentTabs().selectedId;
      const at = selected ? order.indexOf(selected) : -1;
      open(at >= 0 ? at : focused);
    }
    else if (command.kind === "lift") {
      dragIndex.value = focused;
      dragLift.value = command.offset;
    } else showArchiveCardNow();
  }, [command, phase.kind]);

  const openingId = useRef<string | null>(null);
  useEffect(() => () => void (openingId.current = null), []);
  const open = (index: number) => {
    beginInteraction("card open", INTERACTION_WINDOW_MS.cardOpen);
    const id = order[index];
    if (!id || phase.kind !== "settled" || dragIndex.value === index || flyIndex.value === index) return;
    if (reduceMotion) {
      settledOpen(id);
      return;
    }
    setMenu(null);
    enterPhase({ kind: "closing", id });
    beginOpeningTab(id);
    openingId.current = id;
    whenPageLaidOut(id, OPEN_MOUNT_CAP_MS, () =>
      requestAnimationFrame(() => {
        if (openingId.current !== id) return;
        scaleProgress.value = withSpring(0, tabsMotion.expand);
        positionProgress.value = withSpring(0, tabsMotion.expand, (finished) => {
          if (finished) runOnJS(settledOpen)(id);
          else runOnJS(stopOpeningTab)(id);
        });
      }),
    );
  };

  const remove = (id: string) => {
    hidden.current.add(id);
    closeTabFromDeck(id);
  };

  const close = (index: number, startLift: number) => {
    const id = order[index];
    if (!id) return;
    hideArchiveCard();
    if (reduceMotion) {
      remove(id);
      return;
    }
    const lift = startLift - g.cardHeight * 0.18;
    const size = g.cardWidth * POOF.sizeShare;
    const spec = { id: ++poofSeed.current, x: deckLeading(g, index - scroll.value) + g.cardWidth / 2, y: poofCentreY(g.cardCenterY + lift, size, g.safeTop), size };
    setPoofs((now) => [...now, spec]);
    setTimeout(() => setPoofs((now) => now.filter((poof) => poof.id !== spec.id)), POOF.durationMs + POOF_LINGER_MS);
    flyIndex.value = index;
    flyLift.value = startLift;
    flyVanish.value = 0;
    dragIndex.value = -1;
    flyLift.value = withTiming(startLift - g.cardHeight * 0.18, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    flyVanish.value = withTiming(1, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    setTimeout(() => remove(id), tabsMotion.flyAway * 0.6);
  };

  const count = order.length;
  const [anchor, setAnchor] = useState(() => focusedIndex(scroll.value, order.length));
  const touching = useSharedValue(false);
  useAnimatedReaction(
    () => (touching.value ? focusedIndex(scroll.value, count) : -1),
    (focused, previous) => {
      if (focused >= 0 && previous !== null && previous >= 0 && focused !== previous) runOnJS(focusTick)();
    },
    [count],
  );
  const startScroll = useSharedValue(0);
  const vertical = useSharedValue(false);
  const touchDown = useSharedValue({ x: 0, y: 0, absoluteX: 0, absoluteY: 0 });
  const scrollFrom = useSharedValue(0);
  const pan = Gesture.Pan()
    .withTestId("deckPan")
    .minDistance(10)
    .onBegin((e) => {
      touchDown.value = { x: e.x, y: e.y, absoluteX: e.absoluteX, absoluteY: e.absoluteY };
    })

    .onStart((e) => {
      const down = touchDown.value;
      const card = deckCardAt(g, count, scroll.value, down.x, down.y);
      if (measuresInteractions) runOnJS(beginInteraction)("deck scroll", INTERACTION_WINDOW_MS.deckScroll);
      startScroll.value = scroll.value;
      scrollFrom.value = e.absoluteX;
      touching.value = true;
      runOnJS(touchChanged)(true);
      runOnJS(hideArchiveCard)();
      if (deckDragKind(card, e.absoluteX - down.absoluteX, e.absoluteY - down.absoluteY) === "lift") {
        vertical.value = true;
        dragIndex.value = card;
        dragLift.value = deckLift(e.absoluteY - down.absoluteY);
        return;
      }
      vertical.value = false;
    })
    .onUpdate((e) => {
      const down = touchDown.value;
      if (vertical.value) {
        dragLift.value = deckLift(e.absoluteY - down.absoluteY);
        return;
      }
      scroll.value = deckScrollDuringDrag(g, startScroll.value, e.absoluteX - scrollFrom.value, count);
    })
    .onEnd((e) => {
      if (vertical.value) {
        touching.value = false;
        const card = dragIndex.value;
        if (deckShouldClose(e.absoluteY - touchDown.value.absoluteY, e.velocityY, g.cardHeight)) {
          runOnJS(flickTick)();
          runOnJS(close)(card, dragLift.value);
          runOnJS(touchChanged)(false);
        } else {
          dragLift.value = withSpring(0, tabsMotion.release, (finished) => {
            if (finished) dragIndex.value = -1;
            runOnJS(touchChanged)(false);
          });
        }
        return;
      }
      const target = deckSettleTarget(g, scroll.value, e.velocityX, count);
      const settled = () => {
        "worklet";
        touching.value = false;
        runOnJS(setAnchor)(target);
        runOnJS(touchChanged)(false);
      };
      scroll.value = reduceMotion
        ? withTiming(target, { duration: tabsMotion.fade, easing: tabsCurve.easeOut }, settled)
        : withSpring(target, { ...tabsMotion.settle, velocity: deckSettleVelocity(g, scroll.value, target, e.velocityX) }, settled);
    });
  const showCardMenu = (index: number, x: number, y: number) => {
    if (phase.kind !== "settled" || !order[index]) return;
    menuOpenedHaptic();
    hideArchiveCard();
    setMenu(null);
    setCardMenu({ index, x, y });
  };
  const longPress = Gesture.LongPress()
    .minDuration(tabsMotion.longPress)
    .onStart((e) => {
      const card = deckCardAt(g, count, scroll.value, e.x, e.y);
      if (card >= 0) runOnJS(showCardMenu)(card, e.x, e.y);
    });
  const tapFrom = useSharedValue({ x: 0, y: 0 });
  const tap = Gesture.Manual()
    .onTouchesDown((e) => {
      const touch = e.allTouches[0];
      if (touch) tapFrom.value = { x: touch.x, y: touch.y };
    })
    .onTouchesUp((e, manager) => {
      const touch = e.changedTouches[0];
      if (touch && deckIsTap(touch.x - tapFrom.value.x, touch.y - tapFrom.value.y)) {
        const card = deckCardAt(g, count, scroll.value, touch.x, touch.y);
        if (card >= 0) runOnJS(open)(card);
      }
      manager.fail();
    });

  const cardMenuItems = (index: number): MenuItem[] => {
    const tab = tabs.get(order[index] ?? "");
    const closing: MenuItem = { label: "Close Tab", icon: "xmark", destructive: true, onPress: () => close(index, 0) };
    if (!tab || !canShareTab(tab)) return [closing];
    const sends: MenuItem[] = sendTargetsFor(tab).map((device) => ({
      label: `Send to ${device.name}`,
      icon: device.kind === "phone" ? "iphone" : "laptop",
      onPress: () => void sendTab(tab, device),
    }));
    const pin: MenuItem[] = !tab.isPrivate && syncEnabled ? [{ label: "Pin to Mac", icon: "star", onPress: () => void pinToMac(tab, () => openSettings({ page: "sync" })) }] : [];
    return [
      { label: "Copy Link", icon: "link", onPress: () => copyTabLink(tab) },
      { label: "Share", icon: "squareAndArrowUp", onPress: () => shareTab(tab) },
      ...sends,
      ...pin,
      "divider",
      closing,
    ];
  };

  const confirmCloseAll = () =>
    setConfirmation({
      title: count === 1 ? "Close 1 Tab?" : `Close ${count} Tabs?`,
      message: privateCount ? "Incognito tabs aren’t saved. Other tabs stay in your Archive." : "They’ll stay in your Archive.",
      action: count === 1 ? "Close Tab" : "Close All Tabs",
      run: () => {
        hideArchiveCard();
        haptics.press();
        closeAllFromDeck();
      },
    });
  const confirmLeaveIncognito = () =>
    setConfirmation({
      title: "Close Incognito Tabs?",
      message: "Their pages, cookies and history are cleared.",
      action: "Close Incognito Tabs",
      run: () => {
        haptics.press();
        leaveIncognito();
      },
    });

  const closeNow = (at: number) => {
    const closing = order[at];
    if (closing) remove(closing);
  };
  const latestActions = useRef({ open, close, closeNow });
  latestActions.current = { open, close, closeNow };
  const cardActions = useMemo(
    () => ({
      open: (at: number) => latestActions.current.open(at),
      close: (at: number) => latestActions.current.close(at, 0),
      closeNow: (at: number) => latestActions.current.closeNow(at),
    }),
    [],
  );
  const plusItems: MenuItem[] = incognito
    ? [
        { label: "New Tab", icon: "plus", onPress: newRegularTab },
        { label: "New Incognito Tab", icon: "eyes", onPress: newTab },
      ]
    : [
        { label: "New Incognito Tab", icon: "eyes", onPress: newIncognitoTab },
        ...(canReopen ? [{ label: "Reopen Closed Tab", icon: "arrowUturnBackward" as const, onPress: reopenLastClosed }] : []),
      ];
  if (count)
    plusItems.push("divider", {
      label: incognito ? "Close Incognito Tabs" : "Close All Tabs",
      icon: "xmark",
      destructive: true,
      onPress: incognito ? confirmLeaveIncognito : confirmCloseAll,
    });

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(event) => setDeckHeight(event.nativeEvent.layout.height)}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        <DeckLookBackdropBase />
        <FrostSource name={DECK_FROST} style={StyleSheet.absoluteFill} pointerEvents="none">
          <DeckLookBackdrop baseOutside />
        </FrostSource>
      </Animated.View>
      <Shade shaded={menu !== null || cardMenu !== null || confirmation !== null}>
        <ScrollActions
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          canScrollForward={deckScrollActionTarget(anchor, count, "forward") !== null}
          canScrollBackward={deckScrollActionTarget(anchor, count, "backward") !== null}
          onScrollAction={(direction) => {
            const target = deckScrollActionTarget(anchor, count, direction);
            if (target === null) return;
            setAnchor(target);
            scroll.value = reduceMotion ? withTiming(target, { duration: tabsMotion.fade }) : withSpring(target, tabsMotion.settle);
          }}
        >
          <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
            <Animated.View style={[styles.touch, { height: g.barCenterY - tabsLayout.barTouchClearance }, cardsStyle]} collapsable={false}>
              {order.map((id, index) => {
                const tab = tabs.get(id);
                if (!tab || hidden.current.has(id) || !deckCardMounted(index, anchor)) return null;
                return (
                  <DeckCard
                    key={id}
                    tab={tab}
                    index={index}
                    geometry={g}
                    motion={motion}
                    onOpen={cardActions.open}
                    onClose={cardActions.close}
                    onCloseNow={cardActions.closeNow}
                  />
                );
              })}
            </Animated.View>
          </GestureDetector>
        </ScrollActions>
        {!count && phase.kind === "settled" ? <DeckEmpty centerY={g.cardCenterY} showsArchive={hasArchive} onArchive={openArchive} /> : null}
        {archiveCard && phase.kind === "settled" ? <ArchiveIntervalCard edgeY={archiveCardEdgeY(g, archiveCardLayout.aboveBarCenter)} /> : null}
        {privateCount > 0 ? (
          <Animated.View style={[StyleSheet.absoluteFill, chipStyle]} pointerEvents={phase.kind === "settled" ? "box-none" : "none"}>
            <IncognitoChip count={privateCount} top={g.safeTop} onPress={() => setMenu("chip")} />
          </Animated.View>
        ) : null}
        {
          <Animated.View
            pointerEvents={phase.kind === "settled" ? "box-none" : "none"}
            style={[styles.bar, { top: g.barCenterY - tabsLayout.barPlus.height / 2 - 2, paddingHorizontal: tabsLayout.barSideInset - 4 }, chromeStyle]}
          >
            <DeckBar
              leading={
                syncEnabled ? { icon: "laptop", label: "Synced Tabs", onPress: openSpaces } : { icon: "archivebox", label: "Archive", onPress: openArchive }
              }
              plusLabel={incognito ? "New Incognito Tab" : "New Tab"}
              frost={{ source: DECK_FROST, variant: "bar" }}
              covered={trayOpen}
              onPlus={newTab}
              onPlusMenu={() => setMenu("plus")}
              onSettings={() => openSettings()}
            />
          </Animated.View>
        }
        {poofs.map((spec) => (
          <PoofBurst key={spec.id} spec={spec} />
        ))}
      </Shade>
      <DeckLookProbe
        busy={phase.kind !== "settled" || menu !== null || cardMenu !== null || confirmation !== null || deckSheet !== null || trayOpen || deckSurface !== "deck"}
        touch={probeTouch}
      />
      {menu === "plus" ? (
        <Menu
          items={plusItems}
          place={{ bottom: (deckHeight ?? height) - g.barCenterY + tabsLayout.barPlus.height, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
      {menu === "chip" ? (
        <Menu
          items={[{ label: "Close Incognito Tabs", icon: "xmark", destructive: true, onPress: confirmLeaveIncognito }]}
          place={{ top: g.safeTop + tabsLayout.chipHeight + tabsLayout.headerGap * 2, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
      {cardMenu ? (
        <Menu
          items={cardMenuItems(cardMenu.index)}
          place={{
            top: Math.min(cardMenu.y, height - tabsLayout.cardMenuHeight),
            left: Math.min(Math.max(cardMenu.x - tabsLayout.menuWidth / 2, space.l), width - tabsLayout.menuWidth - space.l),
            width: tabsLayout.menuWidth,
          }}
          onDismiss={() => setCardMenu(null)}
        />
      ) : null}
      {confirmation ? <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} /> : null}
    </View>
  );
}

const focusTick = () => haptics.tick();
const flickTick = () => haptics.tap();

const DECK_FROST = "deck";
const OPEN_MOUNT_CAP_MS = 150;

const DECK_RENDER_REACH = 6;
const DECK_GESTURE_REACH = 3;

const deckCardMounted = (index: number, anchor: number) => Math.abs(index - anchor) <= DECK_RENDER_REACH + DECK_GESTURE_REACH;
const BACKDROP_LEAD = 1.4;
const CHROME_FROM = 0.6;
const POOF_LINGER_MS = 50;

const styles = StyleSheet.create({
  touch: { position: "absolute", left: 0, right: 0, top: 0 },
  bar: { position: "absolute", left: 0, right: 0 },
});
