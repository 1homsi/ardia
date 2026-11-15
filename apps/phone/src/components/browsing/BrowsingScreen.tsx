import { memo, useEffect, useMemo, useState } from "react";
import { countRender } from "../../state/app/interactionPerf";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BAR_SHOWN, followScroll, pageInsets } from "../../lib/barCollapse";
import { neighbours } from "../../lib/pagerPhysics";
import { useSystemBars } from "../../state/app/systemBars";
import { useFrozenOrder, useNavigation, usePageTone } from "../../state/browse/hooks";
import { closePageMenu, editPageQuery, openPageMenu } from "../../state/page/actions";
import { useFindOpen, useMenuOpen, usePressOpen, useReaderTabId } from "../../state/page/hooks";
import { captureCurrentCover, newTab, pageLaidOut, showDeck, swipeOrder, switchToNeighbour } from "../../state/browse/store";
import { useSearchOpen } from "../../state/search/hooks";
import { usePreferences } from "../../state/settings/hooks";
import { closeFrontTab, menuOpenedHaptic, recentTabs, switchToTab, tabTitle } from "../../state/browse/tabMenus";
import { useDeckOrder } from "../../state/tabs/hooks";
import type { BrowserTab } from "../../state/tabs/tabModels";
import {
  barCenterFromBottom,
  barHeight,
  browseLayout,
  isDarkColor,
  LoadingLine,
  Menu,
  Shade,
  rolesFor,
  space,
  tabsInk,
  tabsLayout,
  tabsMotion,
  floatingBarLayout,
  pageObscuresInsets,
  useDesign,
  usePresence,
  useTheme,
  type MenuItem,
  useReduceMotion,
} from "../ui";
import { BottomBar } from "./BottomBar";
import { FloatingBar } from "./FloatingBar";
import { FindBar } from "./FindBar";
import { PageMenu } from "./PageMenu";
import { PageRequestHost, PressMenu } from "./PageRequests";
import { ReaderView } from "./ReaderView";
import { PageFailureView } from "./PageFailureView";
import { PageCover } from "./PageCover";
import { PageSurface } from "./PageSurface";
import { useDemoMotion } from "./DemoMotion";
import { PagerBlack, PagerNeighbour, useTabPager } from "./TabPager";
import { launchArguments } from "../../state/app/launchFlags";
import { shownTone } from "../../lib/pageTone";

export const BrowsingScreen = memo(function BrowsingScreen({ tab }: { tab: BrowserTab }) {
  countRender("BrowsingScreen");
  const theme = useTheme();
  const design = useDesign();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const menuOpen = useMenuOpen();
  const finding = useFindOpen();
  const readerId = useReaderTabId();
  const pressing = usePressOpen();
  const tone = usePageTone(tab.id);
  const order = useDeckOrder();
  const frozen = useFrozenOrder();
  const searching = useSearchOpen();
  const [tabsMenu, setTabsMenu] = useState(false);
  const menu = usePresence(menuOpen);
  useEffect(() => closePageMenu, [tab.id]);
  const byId = useMemo(() => new Map(order.map((t) => [t.id, t])), [order]);
  const around = useMemo(() => neighbours(swipeOrder(), tab.id), [order, frozen, tab.id]);
  const left = around.left ? (byId.get(around.left) ?? null) : null;
  const right = around.right ? (byId.get(around.right) ?? null) : null;
  const pager = useTabPager({
    width,
    selectedId: tab.id,
    left: left?.id ?? null,
    right: right?.id ?? null,
    onCommit: switchToNeighbour,
    onGrab: captureCurrentCover,
  });
  useDemoMotion(pager, width);
  const failed = useNavigation(tab.id, (n) => n?.failure != null);
  const pageTone = failed ? null : shownTone(tone, tab.themeColorHex);
  const top = pageTone?.top ?? theme.surface;
  const bottom = pageTone?.bottom ?? theme.surface;
  const barDark = design === "redesigned" && !pageTone?.bottom ? theme.dark : isDarkColor(bottom);
  useSystemBars(isDarkColor(top), barDark);
  const collapse = useBarCollapse(tab.id, finding);
  const underBar = design === "redesigned" && pageObscuresInsets();
  const layout = underBar ? { pageBottom: 0, toneBottom: barHeight(insets.bottom, design) } : pageInsets(collapse.collapses, barHeight(insets.bottom, design), browseLayout.pageOverlap);
  const painted = useSharedValue(false);
  useEffect(() => {
    painted.value = true;
  }, [painted]);
  const openTabsMenu = () => {
    menuOpenedHaptic();
    setTabsMenu(true);
  };
  const stepTab = (delta: -1 | 1) => {
    const id = delta < 0 ? left?.id : right?.id;
    if (id) switchToNeighbour(id);
  };
  const statusStyle = useAnimatedStyle(() => ({ backgroundColor: painted.value ? withTiming(top, { duration: tabsMotion.barTone }) : top }), [top]);
  const barStyle = useAnimatedStyle(() => ({ backgroundColor: painted.value ? withTiming(bottom, { duration: tabsMotion.barTone }) : bottom }), [bottom]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]} onLayout={() => pageLaidOut(tab.id)}>
      <Shade shaded={menuOpen || readerId === tab.id || pressing || tabsMenu}>
        <PagerBlack />
        <Animated.View style={[StyleSheet.absoluteFill, styles.outgoing, { backgroundColor: theme.surface }, pager.outgoing]}>
          {underBar ? null : <Animated.View testID="pageStatusStrip" style={[{ height: insets.top }, statusStyle]} />}
          <View testID="pageArea" style={[styles.page, { marginBottom: layout.pageBottom }]}>
            <PageSurface key={tab.id} tab={tab} toneBottom={layout.toneBottom} obscured={underBar ? { top: insets.top, bottom: barHeight(insets.bottom, design) } : undefined} />
            <PageCover key={`${tab.id}:cover`} tab={tab} />
            <PageFailureView key={`${tab.id}:failure`} tabId={tab.id} />
          </View>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tabsInk.pagerBlack }, pager.dim]} pointerEvents="none" />
        </Animated.View>
        {left ? <PagerNeighbour pager={pager} tab={left} side={-1} width={width} statusHeight={insets.top} hasLeft hasRight={right !== null} /> : null}
        {right ? <PagerNeighbour pager={pager} tab={right} side={1} width={width} statusHeight={insets.top} hasLeft={left !== null} hasRight /> : null}
        <View style={[styles.loading, { top: insets.top }]} pointerEvents="none">
          <PageLoadingLine tabId={tab.id} color={theme.accent} />
        </View>
        {
          <GestureDetector gesture={pager.gesture}>
            <Animated.View
              pointerEvents={collapse.hidden ? "none" : design === "redesigned" ? "box-none" : "auto"}
              importantForAccessibility={collapse.hidden ? "no-hide-descendants" : "auto"}
              style={[styles.bar, { height: barHeight(insets.bottom, design) }, underBar ? null : barStyle, collapse.style]}
            >
              {design === "redesigned" ? (
                <View style={[styles.controls, { bottom: barCenterFromBottom(insets.bottom, design) - floatingBarLayout.control / 2 }]} pointerEvents="box-none">
                  <FloatingBar
                    tab={tab}
                    order={order}
                    roles={rolesFor(barDark)}
                    dark={barDark}
                    showsPlus={!searching}
                    onTabs={showDeck}
                    onTabsMenu={openTabsMenu}
                    onStep={stepTab}
                    onAddress={editPageQuery}
                    onPlus={newTab}
                    onMore={openPageMenu}
                  />
                </View>
              ) : (
                <>
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: barDark ? tabsInk.barShadeOnDark : tabsInk.barShadeOnLight }]} />
                  <View style={[styles.controls, { bottom: barCenterFromBottom(insets.bottom, design) - browseLayout.hitTarget / 2 }]}>
                    <BottomBar order={order} roles={rolesFor(barDark)} showsPlus={!searching} onTabs={showDeck} onTabsMenu={openTabsMenu} onStep={stepTab} onPlus={newTab} onMore={openPageMenu} />
                  </View>
                </>
              )}
            </Animated.View>
          </GestureDetector>
        }
        {finding ? <FindBar tabId={tab.id} /> : null}
      </Shade>
      {tabsMenu ? (
        <Menu
          items={tabsMenuItems(order)}
          place={{ bottom: barHeight(insets.bottom, design) + space.xs, left: space.l, width: Math.min(tabsLayout.menuWidth, width - space.l * 2) }}
          onDismiss={() => setTabsMenu(false)}
        />
      ) : null}
      <PressMenu width={width} height={height} />
      {menu.mounted ? <PageMenu tabId={tab.id} open={menuOpen} onHidden={menu.hidden} /> : null}
      {readerId === tab.id ? <ReaderView tabId={tab.id} /> : null}
      <PageRequestHost tabId={tab.id} />
    </View>
  );
});

function useBarCollapse(tabId: string, finding: boolean) {
  const collapses = usePreferences((p) => p.collapsesBottomBar);
  const direction = useNavigation(tabId, (n) => n?.scrollDirection ?? "up");
  const page = useNavigation(tabId, (n) => n?.url ?? null);
  const reduceMotion = useReduceMotion();
  const [state, setState] = useState(() => followScroll(BAR_SHOWN, tabId, page, direction, collapses));
  useEffect(() => setState((now) => followScroll(now, tabId, page, direction, collapses)), [tabId, page, direction, collapses]);
  const hidden = (state.hidden && state.tabId === tabId) || finding;
  const hide = useSharedValue(0);
  useEffect(() => {
    hide.value = reduceMotion ? withTiming(hidden ? 1 : 0, { duration: tabsMotion.barCollapseReduced }) : withSpring(hidden ? 1 : 0, tabsMotion.barCollapse);
  }, [hidden, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - hide.value, transform: [{ translateY: hide.value * browseLayout.barCollapseTravel }] }));
  return { collapses, hidden, style };
}

function tabsMenuItems(order: BrowserTab[]): MenuItem[] {
  const others = recentTabs(order).map((tab): MenuItem => ({ label: tabTitle(tab), onPress: () => switchToTab(tab.id) }));
  return [...others, ...(others.length ? ["divider" as const] : []), { label: "Close Tab", icon: "xmark", destructive: true, onPress: closeFrontTab }];
}

function PageLoadingLine({ tabId, color }: { tabId: string; color: string }) {
  const loadFreeze = launchArguments().loadFreeze;
  const liveProgress = useNavigation(tabId, (n) => n?.progress ?? 0);
  const liveLoading = useNavigation(tabId, (n) => n?.isLoading ?? true);
  return <LoadingLine progress={loadFreeze ?? liveProgress} isLoading={loadFreeze !== null || liveLoading} color={color} />;
}


const styles = StyleSheet.create({
  outgoing: { overflow: "hidden" },
  page: { flex: 1 },
  loading: { position: "absolute", left: 0, right: 0 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0 },
  controls: { position: "absolute", left: 0, right: 0 },
});
