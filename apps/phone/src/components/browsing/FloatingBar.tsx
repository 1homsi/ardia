import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptics } from "../../state/app/haptics";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { capsule, chromeInk, ChromeSurface, Favicon, floatingBarLayout, PressScale, Symbol, useTheme, type ColorRoles } from "../ui";
import { TabStack } from "./BottomBar";

type Props = {
  tab: BrowserTab;
  order: BrowserTab[];
  roles: ColorRoles;
  showsPlus: boolean;
  onTabs: () => void;
  onTabsMenu: () => void;
  onStep: (delta: -1 | 1) => void;
  onAddress: () => void;
  onPlus: () => void;
  onMore: () => void;
};

export type BarAddress = { host: string; insecure: boolean; isPrivate: boolean; iconUrl: string | null; pageUrl: string | null };

export function barAddress(tab: BrowserTab): BarAddress {
  const shown = display(tab.url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(tab.url)?.[1]?.toLowerCase() ?? null;
  return {
    host: shown.host || tab.title || "New Tab",
    insecure: scheme === "http",
    isPrivate: tab.isPrivate,
    iconUrl: tab.faviconUrl,
    pageUrl: tab.url || null,
  };
}

export function FloatingBar({ tab, order, roles, showsPlus, onTabs, onTabsMenu, onStep, onAddress, onPlus, onMore }: Props) {
  const theme = useTheme();
  const ink = theme.dark || tab.isPrivate ? chromeInk.dark : chromeInk.light;
  const address = barAddress(tab);
  const count = order.length;
  const size = floatingBarLayout.control;
  return (
    <View testID="floatingBar" style={styles.row} pointerEvents="box-none">
      <PressScale
        label="Tabs"
        value={`${count} ${count === 1 ? "tab" : "tabs"}`}
        hint="Touch and hold for recent tabs."
        longPressLabel="Recent Tabs"
        actions={[
          { name: "previousTab", label: "Previous Tab", run: () => onStep(-1) },
          { name: "nextTab", label: "Next Tab", run: () => onStep(1) },
        ]}
        onPress={onTabs}
        onPressIn={haptics.barPress}
        onLongPress={onTabsMenu}
        style={styles.circleHit}
      >
        <ChromeSurface testID="floatingBarTabs" shape="circle" cornerRadius={capsule(size)} incognito={tab.isPrivate} barShadow style={styles.circle}>
          <View pointerEvents="none">
            <TabStack tabs={order.slice(-2)} roles={roles} />
          </View>
        </ChromeSurface>
      </PressScale>
      <ChromeSurface testID="floatingBarAddress" shape="capsule" cornerRadius={capsule(size)} incognito={tab.isPrivate} barShadow style={styles.address}>
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
            <Symbol name="eyeglasses" size={floatingBarLayout.siteIcon * floatingBarLayout.privateIconShare} color={ink.secondary} />
          ) : address.pageUrl ? (
            <Favicon iconUrl={address.iconUrl} pageUrl={address.pageUrl} size={floatingBarLayout.siteIcon} />
          ) : null}
          <Text testID="floatingBarHost" maxFontSizeMultiplier={floatingBarLayout.maxTextScale} numberOfLines={1} ellipsizeMode="middle" style={[styles.host, { color: ink.foreground }]}>
            {address.host}
          </Text>
        </Pressable>
        <PressScale label="Page Menu" onPress={onMore} onPressIn={haptics.barPress} style={styles.menu}>
          <Symbol name="ellipsis" size={floatingBarLayout.menuGlyph} color={ink.foreground} />
        </PressScale>
      </ChromeSurface>
      <View style={styles.circleHit}>
        {showsPlus ? (
          <PressScale label="New Search" onPress={onPlus} onPressIn={haptics.barPress} style={styles.circleHit}>
            <ChromeSurface testID="floatingBarPlus" shape="circle" cornerRadius={capsule(size)} incognito={tab.isPrivate} barShadow style={styles.circle}>
              <Symbol name="plus" size={floatingBarLayout.glyph} color={ink.foreground} />
            </ChromeSurface>
          </PressScale>
        ) : null}
      </View>
    </View>
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
