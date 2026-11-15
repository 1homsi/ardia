import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DeckLookProbe } from "./DeckLookProbe";
import { useSheet, useSurface } from "../../state/browse/hooks";
import { useHeldDeckOrder, useHeldRootSize, useHeldSearchOpen } from "../../state/browse/deckHold";
import { beginInteraction, countRender, INTERACTION_WINDOW_MS, interactionPerfEnabled } from "../../state/app/interactionPerf";
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, runOnUI, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { POOF, poofCentreY } from "../../lib/poof";
import { pictureKey, whenPicturePainted } from "../../lib/shownSnapshots";
import { countUsage } from "../../state/telemetry/telemetry";
import { PoofBurst, type PoofSpec } from "./PoofBurst";
import { haptics } from "../../state/app/haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { measuredOr } from "../../state/app/rootSize";
import {
  deckCardAt,
  deckGeometry,
  archiveCardEdgeY,
  deckScrollActionTarget,
  deckChromeOpacity,
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
  deckSlotsNow,
  mergeDeckOrder,
  type DeckSlots,
} from "../../lib/deckGeometry";
import {
  beginOpeningTab,
  closeAllFromDeck,
  closeTabFromDeck,
  consumeDeckEntrance,
  deckEntranceCapture,
  peekDeckEntrance,
  deckEntered,
  leaveIncognito,
  newIncognitoTab,
  newRegularTab,
  newTab,
  openArchive,
  openSpaces,
  openTab,
  reopenLastClosed,
  whenPageLaidOut,
} from "../../state/browse/store";
import { canShareTab, copyTabLink, menuOpenedHaptic, shareTab } from "../../state/browse/tabMenus";
import { useCanReopen, useHasArchivedTabs, useIncognito, usePrivateCount, useShownSpace } from "../../state/tabs/hooks";
import { archiveCardLayout, ConfirmDialog, deckChromeLayout, deckChromeMotion, DeckLookBackdrop, DeckLookBackdropBase, FrostSource, Menu, moveTo, poofMs, ScrollActions, Shade, space, tabsCurve, tabsLayout, tabsMotion, type Confirmation, type MenuItem, useDesign, useReduceMotion } from "../ui";
import { openSettings } from "../../state/settings/hooks";
import { useSyncEnabled } from "../../state/sync/hooks";
import { pinToMac, sendTab, sendTargetsFor, spaceMoveTargets } from "../../state/sync/actions";
import { currentTabs, moveTabToSpace } from "../../state/tabs/store";
import { tabMatchesQuery } from "../../state/tabs/tabModels";
import { DeckBar } from "./DeckBar";
import { DECK_PHASE, DeckCard, type DeckMotion } from "./DeckCard";
import { hideArchiveCard, offerArchiveCard, showArchiveCardNow, useArchiveCardShowing } from "../../state/browse/archiveCard";
import { takeDeckCommand, useDeckCommand } from "../../state/browse/deckCommands";
import { ArchiveCapsule, ArchiveIntervalCard } from "./ArchiveIntervalCard";
import { plusMenuItems } from "./ChromeButtons";
import { DeckBottomBar } from "./DeckBottomBar";
import { deckArchiveBottom, DeckHeader, deckHeaderBottom, type DeckHeaderMenu } from "./DeckHeader";
import { DeckEmpty, IncognitoChip } from "./DeckChrome";
import { spaceMenuSymbol } from "../search/StartSpaces";

type Phase = { kind: "opening" | "settled" | "closing"; id: string | null };

const SETTLED: Phase = { kind: "settled", id: null };
const NO_POOFS: PoofSpec[] = [];

const deckScrollFor = (ids: readonly string[], target: string | null) => {
  const index = target ? ids.indexOf(target) : -1;
  return index >= 0 ? openingDeckScroll(index, ids.length) : initialDeckScroll(ids.length);
};

const entrancePhase = (ids: readonly string[], target: string | null): Phase => (target && ids.includes(target) ? { kind: "opening", id: target } : SETTLED);

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export const TabDeck = memo(function TabDeck() {
  countRender("TabDeck");
  const measuresInteractions = interactionPerfEnabled();
  const deckSurface = useSurface();
  const shown = deckSurface === "deck";
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const root = useHeldRootSize();
  const { width, height } = measuredOr(root, window);
  const design = useDesign();
  const redesigned = design === "redesigned";
  const g = useMemo(() => deckGeometry(width, height, insets.top, insets.bottom, 0, Platform.OS, design, deckHeaderBottom()), [width, height, insets.top, insets.bottom, design]);
  const archiveShift = useMemo(
    () => (redesigned ? deckGeometry(width, height, insets.top, insets.bottom, 0, Platform.OS, design, deckArchiveBottom()).cardCenterY - g.cardCenterY : 0),
    [g, redesigned],
  );
  const [deckHeight, setDeckHeight] = useState(height);
  const { tabs: allTabs, selectedId: heldSelected } = useHeldDeckOrder();
  const shownSpace = useShownSpace();
  const [needle, setNeedle] = useState("");
  const live = useMemo(() => (needle ? allTabs.filter((tab) => tabMatchesQuery(tab, needle)) : allTabs), [allTabs, needle]);
  const incognito = useIncognito();
  const privateCount = usePrivateCount();
  const canReopen = useCanReopen();
  const hasArchive = useHasArchivedTabs();
  const syncEnabled = useSyncEnabled();
  const [first] = useState(() => {
    const ids = live.map((t) => t.id);
    const target = shown ? peekDeckEntrance() : heldSelected;
    const index = target ? ids.indexOf(target) : -1;
    const phase = entrancePhase(ids, target);
    return {
      ids,
      phase,
      scroll: deckScrollFor(ids, target),
      shownPhase: shown ? phase : SETTLED,
      expanded: shown ? index : -1,
      progress: shown && index < 0 ? 1 : 0,
      cardsOpacity: shown && index >= 0 && !(Boolean(live[index]?.snapshotFileName) || deckEntranceCapture(target!) !== null) ? 1 : 0,
    };
  });
  const [order, setOrder] = useState<string[]>(first.ids);
  const [phase, setPhase] = useState<Phase>(first.phase);
  const [menu, setMenu] = useState<"plus" | "chip" | null>(null);
  const [headerMenu, setHeaderMenu] = useState<DeckHeaderMenu | null>(null);
  const [cardMenu, setCardMenu] = useState<{ index: number; x: number; y: number; spaces?: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [poofs, setPoofs] = useState<PoofSpec[]>(NO_POOFS);
  const [anchor, setAnchor] = useState(() => focusedIndex(first.scroll, first.ids.length));
  const syncedShown = useRef(shown);
  const syncedTabs = useRef(allTabs);
  if (syncedShown.current !== shown || (!shown && syncedTabs.current !== allTabs)) {
    const ids = allTabs.map((t) => t.id);
    const target = shown ? peekDeckEntrance() : heldSelected;
    const nextAnchor = focusedIndex(deckScrollFor(ids, target), ids.length);
    const nextPhase = entrancePhase(ids, target);
    if (!sameOrder(order, ids)) setOrder(ids);
    if (nextAnchor !== anchor) setAnchor(nextAnchor);
    if (nextPhase.kind !== phase.kind || nextPhase.id !== phase.id) setPhase(nextPhase);
    if (!shown) {
      if (needle) setNeedle("");
      if (menu) setMenu(null);
      if (headerMenu) setHeaderMenu(null);
      if (cardMenu) setCardMenu(null);
      if (confirmation) setConfirmation(null);
      if (poofs.length) setPoofs(NO_POOFS);
    }
  }
  useLayoutEffect(() => {
    syncedShown.current = shown;
    syncedTabs.current = allTabs;
  });
  const deckSheet = useSheet();
  const reduceMotion = useReduceMotion();
  const trayOpen = useHeldSearchOpen();
  const probeTouch = useRef<(touching: boolean) => void>(() => undefined);
  const touchChanged = useCallback((on: boolean) => probeTouch.current(on), []);
  const archiveCard = useArchiveCardShowing();
  const hidden = useRef(new Set<string>());
  const deckPhase = useSharedValue<number>(DECK_PHASE[first.shownPhase.kind]);
  const expandedIndex = useSharedValue(first.expanded);
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
  const scroll = useSharedValue(first.scroll);
  const scaleProgress = useSharedValue(first.progress);
  const positionProgress = useSharedValue(first.progress);
  const dragIndex = useSharedValue(-1);
  const dragLift = useSharedValue(0);
  const flyIndex = useSharedValue(-1);
  const flyLift = useSharedValue(0);
  const flyVanish = useSharedValue(0);
  const orderIds = useSharedValue<readonly string[]>(first.ids);
  const shiftBy = useSharedValue(0);
  const fromSlots = useSharedValue<DeckSlots>({});
  const gap = useSharedValue(1);
  const motion = useMemo<DeckMotion>(
    () => ({ orderIds, shiftBy, fromSlots, gap, phase: deckPhase, expandedIndex, scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish }),
    [orderIds, shiftBy, fromSlots, gap, deckPhase, expandedIndex, scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish],
  );
  const tabs = useMemo(() => new Map(live.map((t) => [t.id, t])), [live]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: deckPhase.value === DECK_PHASE.closing ? 1 : Math.min(1, positionProgress.value * BACKDROP_LEAD) }));
  const cardsOpacity = useSharedValue(first.cardsOpacity);
  const cardsShift = useSharedValue(0);
  const cardsStyle = useAnimatedStyle(
    () => (redesigned ? { opacity: cardsOpacity.value, transform: [{ translateY: cardsShift.value * Math.min(1, Math.max(0, positionProgress.value)) }] } : { opacity: cardsOpacity.value }),
    [redesigned],
  );
  useEffect(() => {
    if (!redesigned) return;
    const target = archiveCard ? archiveShift : 0;
    cardsShift.value = reduceMotion ? withTiming(target, { duration: tabsMotion.fade }) : withSpring(target, deckChromeMotion.chromeShift);
  }, [archiveCard, archiveShift, redesigned]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: deckChromeOpacity(positionProgress.value) }));
  const chipStyle = useAnimatedStyle(() => ({ opacity: dragIndex.value >= 0 ? 0 : deckChromeOpacity(positionProgress.value) }));

  const poofSeed = useRef(0);
  const searchedFor = useRef(needle);
  const spaceShown = useRef(shownSpace);
  const openingId = useRef<string | null>(null);
  const touching = useSharedValue(false);

  const placeCards = (ids: readonly string[], at: number) =>
    runOnUI((next: readonly string[], to: number) => {
      "worklet";
      fromSlots.value = {};
      shiftBy.value = 0;
      gap.value = 1;
      flyIndex.value = -1;
      flyVanish.value = 0;
      flyLift.value = 0;
      dragIndex.value = -1;
      dragLift.value = 0;
      orderIds.value = next;
      scroll.value = to;
    })(ids, at);

  useLayoutEffect(() => {
    if (shown) return;
    hidden.current.clear();
    openingId.current = null;
    placeCards(order, deckScrollFor(order, heldSelected));
    deckPhase.value = DECK_PHASE.settled;
    expandedIndex.value = -1;
    scaleProgress.value = 0;
    positionProgress.value = 0;
    cardsOpacity.value = 0;
    touching.value = false;
  }, [shown, order, heldSelected]);

  useLayoutEffect(() => {
    if (!shown) return;
    spaceShown.current = shownSpace;
    searchedFor.current = needle;
    const entrance = peekDeckEntrance();
    const index = entrance ? order.indexOf(entrance) : -1;
    placeCards(order, index >= 0 ? openingDeckScroll(index, order.length) : initialDeckScroll(order.length));
    if (!entrance || index < 0) {
      deckPhase.value = DECK_PHASE.settled;
      expandedIndex.value = -1;
      scaleProgress.value = 1;
      positionProgress.value = 1;
      cardsOpacity.value = withTiming(1, { duration: tabsMotion.fade });
      return;
    }
    beginInteraction("deck open", INTERACTION_WINDOW_MS.deckOpen);
    deckPhase.value = DECK_PHASE.opening;
    expandedIndex.value = index;
    scaleProgress.value = 0;
    positionProgress.value = 0;
    const shrink = () => {
      cardsOpacity.value = 1;
      scaleProgress.value = moveTo(1, tabsMotion.openScale);
      positionProgress.value = moveTo(1, tabsMotion.openPosition, (finished) => {
        "worklet";
        if (!finished) return;
        settlePhase();
        runOnJS(setPhase)(SETTLED);
        runOnJS(deckEntered)(entrance);
      });
    };
    const capture = deckEntranceCapture(entrance);
    if (!capture && !tabs.get(entrance)?.snapshotFileName) {
      shrink();
      return () => deckEntered(entrance);
    }
    cardsOpacity.value = 0;
    let frame = 0;
    let live = true;
    let waited = false;
    let stopWaiting = () => {};
    const waitForPaint = () => {
      if (!live || waited) return;
      waited = true;
      const now = currentTabs();
      const picture = [...now.open, ...now.privates].find((tab) => tab.id === entrance)?.snapshotFileName;
      if (!picture) {
        frame = requestAnimationFrame(shrink);
        return;
      }
      stopWaiting = whenPicturePainted(pictureKey(`deck:${entrance}`, picture), ENTRANCE_PAINT_CAP_MS, (painted) => {
        if (!painted && !tabs.get(entrance)?.isPrivate) countUsage("deck_pictures_late");
        frame = requestAnimationFrame(shrink);
      });
    };
    if (capture) {
      const cap = setTimeout(waitForPaint, ENTRANCE_CAPTURE_CAP_MS);
      void capture.then(() => {
        clearTimeout(cap);
        waitForPaint();
      });
      stopWaiting = () => clearTimeout(cap);
    } else waitForPaint();
    return () => {
      live = false;
      stopWaiting();
      cancelAnimationFrame(frame);
      deckEntered(entrance);
    };
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    consumeDeckEntrance();
    offerArchiveCard(order.length);
    return () => void hideArchiveCard();
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const ids = live.map((t) => t.id);
    const alive = new Set(allTabs.map((t) => t.id));
    if (spaceShown.current !== shownSpace) {
      spaceShown.current = shownSpace;
      searchedFor.current = needle;
      showNewSpace(ids, alive);
      return;
    }
    const next = mergeDeckOrder(order, ids);
    const searched = searchedFor.current !== needle;
    searchedFor.current = needle;
    if (!searched && next.length === order.length && next.every((id, i) => id === order[i])) return;
    const before = scroll.value;
    const focused = order[focusedIndex(before, order.length)];
    const stays = focused ? next.indexOf(focused) : -1;
    const removedAt = focused ? order.indexOf(focused) : 0;
    const onlyTail = next.length < order.length && next.every((id, i) => id === order[i]);
    const after = searched ? Math.max(next.length - 1, 0) : scrollAfterClosing(stays >= 0 ? stays : scrollAfterRemoving(removedAt, Math.round(before), next.length), next.length, onlyTail);
    for (const id of hidden.current) if (!alive.has(id)) hidden.current.delete(id);
    const expanded = phase.id ? next.indexOf(phase.id) : -1;
    runOnUI((ids: readonly string[], to: number, by: number, expandedAt: number, keepsExpanded: boolean, reduced: boolean) => {
      "worklet";
      fromSlots.value = deckSlotsNow(orderIds.value, fromSlots.value, shiftBy.value, gap.value);
      flyIndex.value = -1;
      flyVanish.value = 0;
      flyLift.value = 0;
      shiftBy.value = by;
      if (keepsExpanded) expandedIndex.value = expandedAt;
      orderIds.value = ids;
      scroll.value = to;
      gap.value = 0;
      gap.value = reduced ? withTiming(1, { duration: tabsMotion.fade }) : withSpring(1, tabsMotion.gapClose);
    })(next, after, after - before, expanded, phase.id !== null, reduceMotion);
    setAnchor(Math.round(after));
    setOrder(next);
  }, [live]);

  const showNewSpace = (ids: string[], alive: ReadonlySet<string>) => {
    const to = initialDeckScroll(ids.length);
    for (const id of hidden.current) if (!alive.has(id)) hidden.current.delete(id);
    runOnUI((next: readonly string[], at: number) => {
      "worklet";
      fromSlots.value = {};
      shiftBy.value = 0;
      flyIndex.value = -1;
      flyVanish.value = 0;
      flyLift.value = 0;
      dragIndex.value = -1;
      dragLift.value = 0;
      orderIds.value = next;
      scroll.value = at;
      gap.value = 1;
    })(ids, to);
    cardsOpacity.value = 0;
    cardsOpacity.value = withTiming(1, { duration: tabsMotion.fade });
    setAnchor(to);
    setOrder(ids);
    if (!archiveCard) offerArchiveCard(ids.length);
  };

  const settledOpen = (id: string) => openTab(id);

  const command = useDeckCommand((s) => s.command);
  useEffect(() => {
    if (!command || !shown || phase.kind !== "settled") return;
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
  }, [command, phase.kind, shown]);

  useEffect(() => () => void (openingId.current = null), []);
  const open = (index: number) => {
    beginInteraction("card open", INTERACTION_WINDOW_MS.cardOpen);
    const id = order[index];
    if (!id || phase.kind !== "settled" || dragIndex.value === index || flyIndex.value === index) return;
    if (redesigned) Keyboard.dismiss();
    if (reduceMotion) {
      settledOpen(id);
      return;
    }
    setMenu(null);
    enterPhase({ kind: "closing", id });
    openingId.current = id;
    requestAnimationFrame(() => {
      if (openingId.current !== id) return;
      scaleProgress.value = withSpring(0, tabsMotion.expand);
      positionProgress.value = withSpring(0, tabsMotion.expand, (finished) => {
        if (finished) runOnJS(handOver)(id);
      });
    });
  };

  const handOver = (id: string) => {
    if (openingId.current !== id) return;
    beginOpeningTab(id);
    const picture = tabs.get(id)?.snapshotFileName ?? null;
    let waiting = picture ? 2 : 1;
    const ready = () => {
      waiting -= 1;
      if (waiting > 0) return;
      requestAnimationFrame(() => {
        if (openingId.current === id) settledOpen(id);
      });
    };
    whenPageLaidOut(id, HANDOVER_CAP_MS, ready);
    if (picture) whenPicturePainted(pictureKey(`cover:${id}`, picture), HANDOVER_CAP_MS, ready);
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
    const spec = { id: ++poofSeed.current, x: deckLeading(g, index - scroll.value) + g.cardWidth / 2, y: poofCentreY(g.cardCenterY + cardsShift.value + lift, size, g.safeTop), size };
    setPoofs((now) => [...now, spec]);
    setTimeout(() => setPoofs((now) => now.filter((poof) => poof.id !== spec.id)), poofMs + POOF_LINGER_MS);
    flyIndex.value = index;
    flyLift.value = startLift;
    flyVanish.value = 0;
    dragIndex.value = -1;
    flyLift.value = withTiming(startLift - g.cardHeight * 0.18, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    flyVanish.value = withTiming(1, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    setTimeout(() => remove(id), tabsMotion.flyAway * 0.6);
  };

  const count = order.length;
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
    .withTestId("deckLongPress")
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
        else if (redesigned) runOnJS(dismissKeyboard)();
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
    const targets = redesigned ? spaceMoveTargets(tab) : [];
    if (cardMenu?.spaces) return [{ heading: "Move to Space" }, ...targets.map((space): MenuItem => ({ label: space.name, icon: spaceMenuSymbol(space) ?? undefined, onPress: () => moveTabToSpace(tab.id, space.syncId) }))];
    const move: MenuItem[] = targets.length ? [{ label: "Move to Space", icon: "chevronRight", onPress: () => setCardMenu({ ...cardMenu!, index, spaces: true }) }] : [];
    return [
      { label: "Copy Link", icon: "link", onPress: () => copyTabLink(tab) },
      { label: "Share", icon: "squareAndArrowUp", onPress: () => shareTab(tab) },
      ...sends,
      ...pin,
      ...move,
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
    <View
      testID="tabDeck"
      style={[StyleSheet.absoluteFill, shown ? null : styles.hidden]}
      pointerEvents={shown ? "auto" : "none"} collapsable={false}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!shown}
      onLayout={(event) => {
        const laidOut = event.nativeEvent.layout.height;
        if (laidOut > 0) setDeckHeight(laidOut);
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        <DeckLookBackdropBase />
        <FrostSource name={DECK_FROST} style={StyleSheet.absoluteFill} pointerEvents="none">
          <DeckLookBackdrop baseOutside />
        </FrostSource>
      </Animated.View>
      <Shade shaded={menu !== null || headerMenu !== null || cardMenu !== null || confirmation !== null}>
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
          <GestureDetector gesture={shown ? Gesture.Race(pan, longPress, tap) : Gesture.Race(Gesture.Manual().enabled(false).onTouchesDown(ignoreTouch))}>
            <Animated.View testID="deckCards" style={[styles.touch, { height: phase.kind === "settled" ? g.barCenterY - tabsLayout.barTouchClearance : g.height }, cardsStyle]} collapsable={false}>
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
        {!count && phase.kind === "settled" ? <DeckEmpty centerY={g.cardCenterY} showsArchive={hasArchive} onArchive={openArchive} searching={needle !== ""} /> : null}
        {archiveCard && phase.kind === "settled" ? (
          redesigned ? (
            <ArchiveCapsule centerY={g.safeTop + deckChromeLayout.archiveCenter} safeSide={0} />
          ) : (
            <ArchiveIntervalCard edgeY={archiveCardEdgeY(g, archiveCardLayout.aboveBarCenter)} />
          )
        ) : null}
        {redesigned ? (
          <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents={phase.kind === "settled" ? "box-none" : "none"} collapsable={false}>
            <DeckHeader
              safeTop={g.safeTop}
              safeSide={0}
              privateCount={privateCount}
              hasTabs={allTabs.length > 0}
              onMenu={setHeaderMenu}
              onCloseIncognito={confirmLeaveIncognito}
              onCloseAll={confirmCloseAll}
            />
            <DeckBottomBar
              shown={shown}
              barCenterY={g.barCenterY}
              deckHeight={deckHeight}
              safeSide={0}
              incognito={incognito}
              onGrid={dismissKeyboard}
              onQuery={setNeedle}
              onPlusMenu={() => setMenu("plus")}
            />
          </Animated.View>
        ) : privateCount > 0 ? (
          <Animated.View style={[StyleSheet.absoluteFill, chipStyle]} pointerEvents={phase.kind === "settled" ? "box-none" : "none"} collapsable={false}>
            <IncognitoChip count={privateCount} top={g.safeTop} onPress={() => setMenu("chip")} />
          </Animated.View>
        ) : null}
        {redesigned ? null : (
          <Animated.View
            pointerEvents={phase.kind === "settled" ? "box-none" : "none"} collapsable={false}
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
        )}
        {poofs.map((spec) => (
          <PoofBurst key={spec.id} spec={spec} />
        ))}
      </Shade>
      <DeckLookProbe
        busy={phase.kind !== "settled" || menu !== null || headerMenu !== null || cardMenu !== null || confirmation !== null || deckSheet !== null || trayOpen || deckSurface !== "deck" || archiveCard}
        touch={probeTouch}
      />
      {menu === "plus" ? (
        redesigned ? (
          <Menu
            items={plusMenuItems(incognito, canReopen)}
            place={{ bottom: deckHeight - g.barCenterY + deckChromeLayout.barCircle / 2 + deckChromeLayout.menuGap, right: deckChromeLayout.barSideInset, width: tabsLayout.menuWidth }}
            onDismiss={() => setMenu(null)}
          />
        ) : (
          <Menu
            items={plusItems}
            place={{ bottom: deckHeight - g.barCenterY + tabsLayout.barPlus.height, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }}
            onDismiss={() => setMenu(null)}
          />
        )
      ) : null}
      {headerMenu ? <Menu items={headerMenu.items} place={headerMenu.place} onDismiss={() => setHeaderMenu(null)} /> : null}
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
});

const ignoreTouch = () => {
  "worklet";
};

const focusTick = () => haptics.tick();
const dismissKeyboard = () => Keyboard.dismiss();
const flickTick = () => haptics.tap();

const DECK_FROST = "deck";
const HANDOVER_CAP_MS = 250;
const ENTRANCE_PAINT_CAP_MS = 250;
const ENTRANCE_CAPTURE_CAP_MS = 180;

const DECK_RENDER_REACH = 6;
const DECK_GESTURE_REACH = 3;

const deckCardMounted = (index: number, anchor: number) => Math.abs(index - anchor) <= DECK_RENDER_REACH + DECK_GESTURE_REACH;
const BACKDROP_LEAD = 1.4;
const POOF_LINGER_MS = 50;

const styles = StyleSheet.create({
  touch: { position: "absolute", left: 0, right: 0, top: 0 },
  bar: { position: "absolute", left: 0, right: 0 },
  hidden: { display: "none" },
});
