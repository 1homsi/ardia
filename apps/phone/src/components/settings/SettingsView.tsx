import { useEffect, useState, type ReactNode } from "react";
import { I18nManager, Platform, StyleSheet, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { refreshSettings } from "../../state/settings/actions";
import { useSettingsNav, type SettingsRoute } from "../../state/settings/hooks";
import { LookBackdrop, useReduceMotion } from "../ui";
import { materialStandard, sharedAxisMotion } from "../ui/motion";
import { FilterListDetailPage, FilterListsPage, MyFiltersPage, TrustedSitesPage } from "./BlockingPages";
import { AboutPage, ClearDataPage, LicensesPage } from "./DataPages";
import { AppearancePage } from "./AppearancePage";
import { SettingsRoot } from "./SettingsRoot";
import { SearchEnginePage, SiteSettingsPage } from "./SitePages";
import { SyncConnect } from "../sync/SyncConnect";
import { SyncScan } from "../sync/SyncScan";
import { haptics } from "../../state/app/haptics";
import { setConnectPhrase } from "../../state/sync/connectDraft";
import { SyncPage } from "../sync/SyncPage";
import { DefaultBrowserPage } from "./DefaultBrowserPage";
import { WhatsSentPage } from "./WhatsSentPage";
import { popSettings, pushSettings, settingsRouteKey } from "../../state/settings/nav";
import { ExpoSettingsStack } from "./ExpoSettingsStack";
import { BrowseForMePage } from "./BrowseForMePage";
import { PageSummaryPage } from "./PageSummaryPage";

export function SettingsPageFor({ route }: { route: SettingsRoute }) {
  switch (route.page) {
    case "root":
      return <SettingsRoot />;
    case "appearance":
      return <AppearancePage />;
    case "searchEngine":
      return <SearchEnginePage />;
    case "siteSettings":
      return <SiteSettingsPage />;
    case "filterLists":
      return <FilterListsPage />;
    case "filterList":
      return <FilterListDetailPage id={route.id} />;
    case "myFilters":
      return <MyFiltersPage />;
    case "trustedSites":
      return <TrustedSitesPage />;
    case "clearData":
      return <ClearDataPage />;
    case "sync":
      return <SyncPage />;
    case "defaultBrowser":
      return <DefaultBrowserPage />;
    case "syncConnect":
      return <SyncConnect onClose={popSettings} onConnected={popSettings} />;
    case "syncWords":
      return <SyncConnect onClose={popSettings} onConnected={popSettings} />;
    case "syncScan":
      return (
        <SyncScan
          onScan={(text) => {
            haptics.success();
            setConnectPhrase(text);
            popSettings();
          }}
          onEnterWords={() => {
            popSettings();
            pushSettings({ page: "syncWords" });
          }}
          onCancel={popSettings}
        />
      );
    case "about":
      return <AboutPage />;
    case "licenses":
      return <LicensesPage />;
    case "whatsSent":
      return <WhatsSentPage />;
    case "browseForMe":
      return <BrowseForMePage />;
    case "pageSummary":
      return <PageSummaryPage />;
  }
}

export function SettingsView() {
  if (Platform.OS === "ios") return <ExpoSettingsStack />;
  return <HandBuiltSettings />;
}

type ShownPage = { key: string; route: SettingsRoute };

type PageSwap = { from: ShownPage; forward: boolean };

type SettingsPresentation = { open: boolean; page: ShownPage | null; swap: PageSwap | null; revision: number };

type LayerRole = "settled" | "incoming" | "outgoing";

const shownPageOf = (open: boolean, stack: readonly SettingsRoute[]): ShownPage | null => {
  const route = open ? stack[stack.length - 1] : undefined;
  return route ? { key: `${stack.length}:${settingsRouteKey(route)}`, route } : null;
};

function HandBuiltSettings() {
  const open = useSettingsNav((s) => s.open);
  const stack = useSettingsNav((s) => s.stack);
  const popping = useSettingsNav((s) => s.popping);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (open) void refreshSettings();
  }, [open]);
  const latest = shownPageOf(open, stack);
  const [presentation, setPresentation] = useState<SettingsPresentation>({ open, page: latest, swap: null, revision: 0 });
  const { page: shown, swap, revision } = presentation;
  const navigated = latest !== null && latest.key !== shown?.key;
  if (presentation.open !== open || navigated || (reduceMotion && swap)) {
    setPresentation({
      open,
      page: latest ?? shown,
      swap: navigated && shown && presentation.open && !swap && !reduceMotion ? { from: shown, forward: !popping } : null,
      revision: revision + 1,
    });
  }
  const swapId = swap ? revision : 0;
  const settleSwap = (id: number) => setPresentation((now) => (now.swap && now.revision === id ? { ...now, swap: null } : now));
  useEffect(() => {
    if (!swapId) return;
    const cap = setTimeout(() => settleSwap(swapId), sharedAxisMotion.settleCapMs);
    return () => clearTimeout(cap);
  }, [swapId]);
  if (!shown) return null;
  const toward = (swap?.forward ?? true) !== I18nManager.isRTL ? 1 : -1;
  const layers: { page: ShownPage; role: LayerRole }[] = swap && swap.from.key !== shown.key ? [{ page: swap.from, role: "outgoing" }, { page: shown, role: "incoming" }] : [{ page: shown, role: "settled" }];
  return (
    <View testID="settingsStack" style={StyleSheet.absoluteFill}>
      <LookBackdrop />
      {layers.map(({ page, role }) => (
        <SettingsLayer key={page.key} role={role} toward={toward} swapId={swapId} onSettled={settleSwap}>
          <SettingsPageFor route={page.route} />
        </SettingsLayer>
      ))}
    </View>
  );
}

type LayerProps = { role: LayerRole; toward: number; swapId: number; onSettled: (id: number) => void; children: ReactNode };

function SettingsLayer({ role, toward, swapId, onSettled, children }: LayerProps) {
  const seen = useSharedValue(role === "incoming" ? 0 : 1);
  const offset = useSharedValue(role === "incoming" ? toward * sharedAxisMotion.slide : 0);
  useEffect(() => {
    const handoffMs = sharedAxisMotion.ms * sharedAxisMotion.handoff;
    const slide = { duration: sharedAxisMotion.ms, easing: materialStandard };
    if (role === "outgoing") {
      seen.value = withTiming(0, { duration: handoffMs, easing: Easing.linear });
      offset.value = withTiming(-toward * sharedAxisMotion.slide, slide);
      return;
    }
    if (role === "settled") {
      seen.value = 1;
      offset.value = 0;
      return;
    }
    seen.value = withDelay(handoffMs, withTiming(1, { duration: sharedAxisMotion.ms - handoffMs, easing: Easing.linear }));
    offset.value = withTiming(0, slide, (finished) => {
      if (finished) runOnJS(onSettled)(swapId);
    });
  }, [role, swapId]);
  const motion = useAnimatedStyle(() => ({ opacity: role === "settled" ? 1 : seen.value, transform: [{ translateX: role === "settled" ? 0 : offset.value }] }));
  const away = role === "outgoing";
  return (
    <Animated.View testID={`settingsLayer:${role}`} style={[StyleSheet.absoluteFill, motion]} pointerEvents={away ? "none" : "auto"} importantForAccessibility={away ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={away}>
      {children}
    </Animated.View>
  );
}
