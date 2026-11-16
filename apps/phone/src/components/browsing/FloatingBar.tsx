import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptics } from "../../state/app/haptics";
import { TabsMenuTrigger } from "./tabsMenu";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { capsule, chromeInk, ChromeSurface, Favicon, floatingBarLayout, PressScale, Symbol, type ColorRoles } from "../ui";
import { TabStack } from "./BottomBar";

type Props = {
  tab: BrowserTab;
  order: BrowserTab[];
  roles: ColorRoles;
  dark: boolean;
  showsPlus: boolean;
  onTabs: () => void;
  onTabsMenu: () => void;
  onStep: (delta: -1 | 1) => void;
  onAddress: () => void;
  onPlus: () => void;
  onMore: () => void;
};

export type BarAddress = { host: string; insecure: boolean; isPrivate: boolean; iconUrl: string | null; pageUrl: string | null };

const AUTHORITY_PORT = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(?:\[[^\]]*\]|[^/?#:]*):0*(\d+)(?=[/?#]|$)/i;

export function withoutPort(host: string, url: string): string {
  const port = AUTHORITY_PORT.exec(url)?.[1];
  return port && host.endsWith(`:${port}`) ? host.slice(0, -port.length - 1) : host;
}

export function siteHost(url: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]/i.test(url)) return null;
  return withoutPort(display(url).host, url) || null;
}

export function barAddress(tab: BrowserTab): BarAddress {
  const shown = display(tab.url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(tab.url)?.[1]?.toLowerCase() ?? null;
  return {
    host: withoutPort(shown.host, tab.url) || tab.title || "New Tab",
    insecure: scheme === "http",
    isPrivate: tab.isPrivate,
    iconUrl: tab.faviconUrl,
    pageUrl: tab.url || null,
  };
}

export function FloatingBar({ tab, order, roles, dark, showsPlus, onTabs, onTabsMenu, onStep, onAddress, onPlus, onMore }: Props) {
  const ink = dark ? chromeInk.dark : chromeInk.light;
  const address = barAddress(tab);
  const size = floatingBarLayout.control;
  return (
    <View testID="floatingBar" style={styles.row} pointerEvents="box-none">
      <FloatingTabsButton tab={tab} order={order} roles={roles} dark={dark} testID="floatingBarTabs" onTabs={onTabs} onTabsMenu={onTabsMenu} onStep={onStep} />
      <ChromeSurface testID="floatingBarAddress" shape="capsule" cornerRadius={capsule(size)} incognito={tab.isPrivate} dark={dark} barShadow style={styles.address}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={address.insecure ? "Address, Not Secure" : "Address"}
          accessibilityValue={{ text: address.host }}
          accessibilityHint="Opens search with this page’s address."
          onPress={onAddress}
          style={styles.addressHit}
        >
          {address.insecure ? (
            <Text testID="floatingBarNotSecure" maxFontSizeMultiplier={floatingBarLayout.maxTextScale} numberOfLines={1} style={[styles.warning, { color: ink.notSecure }]}>
              Not Secure
            </Text>
          ) : address.isPrivate ? (
            <Symbol name="eyeglassesThin" size={floatingBarLayout.privateSymbol} color={ink.secondary} />
          ) : address.pageUrl ? (
            <Favicon iconUrl={address.iconUrl} pageUrl={address.pageUrl} size={floatingBarLayout.siteIcon} />
          ) : null}
          <Text testID="floatingBarHost" maxFontSizeMultiplier={floatingBarLayout.maxTextScale} numberOfLines={1} ellipsizeMode="middle" style={[styles.host, { color: ink.foreground }]}>
            {address.host}
          </Text>
        </Pressable>
        <PressScale label="Page Menu" onPress={onMore} onPressIn={haptics.barPress} style={styles.menu}>
          <Symbol name="ellipsis" size={floatingBarLayout.menuSymbol} color={ink.foreground} />
        </PressScale>
      </ChromeSurface>
      <View style={styles.circleHit}>
        {showsPlus ? <FloatingPlusButton tab={tab} dark={dark} testID="floatingBarPlus" onPlus={onPlus} /> : null}
      </View>
    </View>
  );
}

type ButtonProps = { tab: BrowserTab; dark: boolean; testID: string };

export function FloatingTabsButton({ tab, order, roles, dark, testID, onTabs, onTabsMenu, onStep }: ButtonProps & { order: BrowserTab[]; roles: ColorRoles; onTabs: () => void; onTabsMenu: () => void; onStep: (delta: -1 | 1) => void }) {
  const count = order.length;
  const size = floatingBarLayout.control;
  return (
    <TabsMenuTrigger order={order} onTabsMenu={onTabsMenu}>
      {({ onLongPress, screenReaderActions }) => (
        <PressScale
          label="Tabs"
          value={`${count} ${count === 1 ? "tab" : "tabs"}`}
          hint="Touch and hold for recent tabs."
          longPressLabel="Recent Tabs"
          actions={[
            ...screenReaderActions,
            { name: "previousTab", label: "Previous Tab", run: () => onStep(-1) },
            { name: "nextTab", label: "Next Tab", run: () => onStep(1) },
          ]}
          onPress={onTabs}
          onPressIn={haptics.barPress}
          onLongPress={onLongPress}
          style={styles.circleHit}
        >
          <ChromeSurface testID={testID} shape="circle" cornerRadius={capsule(size)} incognito={tab.isPrivate} dark={dark} barShadow style={styles.circle}>
            <View pointerEvents="none">
              <TabStack tabs={order.slice(-2)} roles={roles} />
            </View>
          </ChromeSurface>
        </PressScale>
      )}
    </TabsMenuTrigger>
  );
}

export function FloatingPlusButton({ tab, dark, testID, onPlus }: ButtonProps & { onPlus: () => void }) {
  const ink = dark ? chromeInk.dark : chromeInk.light;
  const size = floatingBarLayout.control;
  return (
    <PressScale label="New Search" onPress={onPlus} onPressIn={haptics.barPress} style={styles.circleHit}>
      <ChromeSurface testID={testID} shape="circle" cornerRadius={capsule(size)} incognito={tab.isPrivate} dark={dark} barShadow style={styles.circle}>
        <Symbol name="plus" size={floatingBarLayout.plusSymbol} color={ink.foreground} />
      </ChromeSurface>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: floatingBarLayout.gap,
    paddingHorizontal: floatingBarLayout.edgeInset,
    height: floatingBarLayout.control,
  },
  circleHit: { width: floatingBarLayout.control, height: floatingBarLayout.control },
  circle: { width: floatingBarLayout.control, height: floatingBarLayout.control, alignItems: "center", justifyContent: "center" },
  address: { flex: 1, height: floatingBarLayout.control, flexDirection: "row", alignItems: "center" },
  addressHit: { flex: 1, height: floatingBarLayout.control, flexDirection: "row", alignItems: "center", gap: floatingBarLayout.addressSpacing, paddingLeft: floatingBarLayout.addressLead },
  host: { flexShrink: 1, fontSize: floatingBarLayout.hostText },
  warning: { fontSize: floatingBarLayout.warningText, fontWeight: "500" },
  menu: { width: floatingBarLayout.control, height: floatingBarLayout.control, alignItems: "center", justifyContent: "center" },
});
