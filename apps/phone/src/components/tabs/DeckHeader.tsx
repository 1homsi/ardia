import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { haptics } from "../../state/app/haptics";
import { newIncognitoTab, openArchive, openSpaces, reopenLastClosed } from "../../state/browse/store";
import { menuOpenedHaptic } from "../../state/browse/tabMenus";
import { openSettings } from "../../state/settings/hooks";
import { selectProfile } from "../../state/sync/actions";
import { useSelectedProfile, useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { useCanReopen, useIncognito } from "../../state/tabs/hooks";
import { prepareArchive } from "../../state/tabs/store";
import { countUsage } from "../../state/telemetry/telemetry";
import { browseLayout, deckChromeLayout, font, menuLook, tabsLayout, useTheme, type MenuItem } from "../ui";
import { MenuTrigger, nativeMenus, spaceSystemImage } from "../ui/MenuTrigger";
import { SpaceTitle, spaceMenuSymbol } from "../search/StartSpaces";
import { FadingGlyphs, GlassCircleButton, type ChromeFade } from "./ChromeButtons";

type Props = {
  safeTop: number;
  safeSide: number;
  sideInset: number;
  hasTabs: boolean;
  onCloseAll: () => void;
  menusShown?: boolean;
  onMenu?: (open: boolean) => void;
} & ChromeFade;

export const deckHeaderBottom = () => deckChromeLayout.headerCenter + deckChromeLayout.headerCircle / 2;

export const deckArchiveBottom = () => deckChromeLayout.archiveCenter + deckChromeLayout.archiveHeight / 2;

const menuGroupsRuled = () => nativeMenus() || menuLook.dividerLine > 0;

function joinMenuGroups(groups: readonly MenuItem[][], ruled: boolean = menuGroupsRuled()): MenuItem[] {
  return groups.filter((group) => group.length > 0).flatMap((group, index): MenuItem[] => (index > 0 && ruled ? ["divider", ...group] : group));
}

export function deckMoreMenuItems({ syncEnabled, canReopen, hasTabs, onCloseAll }: { syncEnabled: boolean; canReopen: boolean; hasTabs: boolean; onCloseAll: () => void }): MenuItem[] {
  return joinMenuGroups([
    [{ label: "Archive", onPress: openArchive }, ...(syncEnabled ? [{ label: "Spaces From Your Mac", onPress: openSpaces }] : [])],
    [{ label: "New Incognito Tab", onPress: newIncognitoTab }, ...(canReopen ? [{ label: "Reopen Closed Tab", onPress: reopenLastClosed }] : []), ...(hasTabs ? [{ label: "Close All Tabs", destructive: true, onPress: onCloseAll }] : [])],
    [{ label: "Settings", onPress: () => openSettings() }],
  ]);
}

export function useDeckSpaces() {
  const status = useSyncStatus();
  const view = useSyncView();
  const shown = useSelectedProfile();
  const incognito = useIncognito();
  const spaces = status.isEnabled ? view.profiles : [];
  const current = shown ?? spaces[0] ?? null;
  const choose = (id: string) => {
    if (id === current?.syncId) return;
    haptics.selection();
    if (!incognito) countUsage("spaces_picked");
    selectProfile(id);
  };
  const spaceItems: MenuItem[] = spaces.map((space) => ({ label: space.name, icon: spaceMenuSymbol(space) ?? undefined, systemImage: spaceSystemImage(space.name, space.icon), checked: space.syncId === current?.syncId, onPress: () => choose(space.syncId) }));
  return { syncEnabled: status.isEnabled, spaces, current, spaceItems };
}

export function DeckHeader({ safeTop, safeSide, sideInset, hasTabs, onCloseAll, menusShown = true, onMenu, glassShown, glassShownMs, glyphFade }: Props) {
  const theme = useTheme();
  const canReopen = useCanReopen();
  const { syncEnabled, spaces, current, spaceItems } = useDeckSpaces();
  const side = safeSide + sideInset;
  const below = safeTop + deckHeaderBottom() + deckChromeLayout.menuGap;
  const opened = () => onMenu?.(true);
  const closed = () => onMenu?.(false);
  const openedMore = () => {
    opened();
    prepareArchive();
  };
  const menu = { trigger: "tap" as const, fixedOrder: true, haptic: menuOpenedHaptic, disabled: !menusShown, onOpen: opened, onClose: closed };
  const moreItems = deckMoreMenuItems({ syncEnabled, canReopen, hasTabs, onCloseAll });
  return (
    <View testID="deckHeader" pointerEvents="box-none" style={[styles.row, { top: safeTop + deckChromeLayout.headerCenter - browseLayout.hitTarget / 2, paddingHorizontal: side }]}>
      <FadingGlyphs testID="deckSwitcher" fade={glyphFade} style={styles.switcher}>
        {current && spaces.length > 1 ? (
          <MenuTrigger items={spaceItems} {...menu} place={{ top: below, left: side, width: tabsLayout.menuWidth }}>
            {({ onPress }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Space, ${current.name}`} accessibilityHint="Shows your Mac’s spaces." onPress={onPress}>
                <SpaceTitle space={current} dark={theme.dark} showsChevron />
              </Pressable>
            )}
          </MenuTrigger>
        ) : current ? (
          <View accessible accessibilityRole="header" accessibilityLabel={current.name}>
            <SpaceTitle space={current} dark={theme.dark} showsChevron={false} />
          </View>
        ) : (
          <Text accessibilityRole="header" numberOfLines={1} style={[font.body, styles.fallback, { color: theme.headerText }]}>
            Tabs
          </Text>
        )}
      </FadingGlyphs>
      <View style={styles.spacer} />
      <MenuTrigger items={moreItems} {...menu} onOpen={Platform.OS === "ios" ? openedMore : opened} place={{ top: below, right: side, width: tabsLayout.menuWidth }}>
        {({ onPress }) => <GlassCircleButton icon="ellipsis" label="More" testID="deckHeaderMore" diameter={deckChromeLayout.headerCircle} dark={theme.dark} glassShown={glassShown} glassShownMs={glassShownMs} glyphFade={glyphFade} onPress={onPress ?? noop} />}
      </MenuTrigger>
    </View>
  );
}

const noop = () => undefined;

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, height: browseLayout.hitTarget, flexDirection: "row", alignItems: "center", gap: deckChromeLayout.headerGap },
  switcher: { flexShrink: 1 },
  spacer: { flex: 1 },
  fallback: { fontWeight: "600" },
});
