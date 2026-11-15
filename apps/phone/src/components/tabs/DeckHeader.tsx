import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { withSpring } from "react-native-reanimated";
import { haptics } from "../../state/app/haptics";
import { newIncognitoTab, openArchive, openSpaces, reopenLastClosed } from "../../state/browse/store";
import { menuOpenedHaptic } from "../../state/browse/tabMenus";
import { openSettings } from "../../state/settings/hooks";
import { selectProfile } from "../../state/sync/actions";
import { useSelectedProfile, useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { useCanReopen, useIncognito } from "../../state/tabs/hooks";
import { countUsage } from "../../state/telemetry/telemetry";
import { browseLayout, capsule, deckChromeInk, deckChromeLayout, deckChromeMotion, font, Symbol, tabsInk, tabsLayout, useTheme, type MenuItem } from "../ui";
import { SpaceTitle, spaceMenuSymbol } from "../search/StartSpaces";
import { GlassCircleButton } from "./ChromeButtons";

export type DeckHeaderMenu = { items: MenuItem[]; place: ViewStyle };

type Props = {
  safeTop: number;
  safeSide: number;
  privateCount: number;
  hasTabs: boolean;
  onMenu: (menu: DeckHeaderMenu) => void;
  onCloseIncognito: () => void;
  onCloseAll: () => void;
};

export const deckHeaderBottom = () => deckChromeLayout.headerCenter + deckChromeLayout.headerCircle / 2;

export const deckArchiveBottom = () => deckChromeLayout.archiveCenter + deckChromeLayout.archiveHeight / 2;

export function DeckHeader({ safeTop, safeSide, privateCount, hasTabs, onMenu, onCloseIncognito, onCloseAll }: Props) {
  const theme = useTheme();
  const status = useSyncStatus();
  const view = useSyncView();
  const shown = useSelectedProfile();
  const canReopen = useCanReopen();
  const incognito = useIncognito();
  const spaces = status.isEnabled ? view.profiles : [];
  const current = shown ?? spaces[0] ?? null;
  const side = safeSide + deckChromeLayout.headerSide;
  const below = safeTop + deckHeaderBottom() + deckChromeLayout.menuGap;
  const present = (items: MenuItem[], place: ViewStyle) => {
    menuOpenedHaptic();
    onMenu({ items, place: { top: below, width: tabsLayout.menuWidth, ...place } });
  };
  const choose = (id: string) => {
    if (id === current?.syncId) return;
    haptics.selection();
    if (!incognito) countUsage("spaces_picked");
    selectProfile(id);
  };
  const showSpaces = () =>
    present(
      spaces.map((space) => ({ label: space.name, icon: spaceMenuSymbol(space) ?? undefined, checked: space.syncId === current?.syncId, onPress: () => choose(space.syncId) })),
      { left: side },
    );
  const showMore = () =>
    present(
      [
        { label: "Archive", onPress: openArchive },
        ...(status.isEnabled ? [{ label: "Spaces From Your Mac", onPress: openSpaces }] : []),
        "divider",
        { label: "New Incognito Tab", onPress: newIncognitoTab },
        ...(canReopen ? [{ label: "Reopen Closed Tab", onPress: reopenLastClosed }] : []),
        ...(hasTabs ? [{ label: "Close All Tabs", destructive: true, onPress: onCloseAll }] : []),
        "divider",
        { label: "Settings", onPress: () => openSettings() },
      ],
      { right: side },
    );
  const showPill = () => present([{ label: "Close Incognito Tabs", destructive: true, onPress: onCloseIncognito }], { right: side + deckChromeLayout.headerCircle + deckChromeLayout.headerGap });
  return (
    <View testID="deckHeader" pointerEvents="box-none" style={[styles.row, { top: safeTop + deckChromeLayout.headerCenter - browseLayout.hitTarget / 2, paddingHorizontal: side }]}>
      <View testID="deckSwitcher" style={styles.switcher}>
        {current && spaces.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Space, ${current.name}`} accessibilityHint="Shows your Mac’s spaces." onPress={showSpaces}>
            <SpaceTitle space={current} dark={theme.dark} showsChevron />
          </Pressable>
        ) : current ? (
          <View accessible accessibilityRole="header" accessibilityLabel={current.name}>
            <SpaceTitle space={current} dark={theme.dark} showsChevron={false} />
          </View>
        ) : (
          <Text accessibilityRole="header" numberOfLines={1} style={[font.body, styles.fallback, { color: theme.headerText }]}>
            Tabs
          </Text>
        )}
      </View>
      <View style={styles.spacer} />
      {privateCount > 0 ? (
        <Animated.View entering={pillIn} exiting={pillOut}>
          <IncognitoPill count={privateCount} onPress={showPill} />
        </Animated.View>
      ) : null}
      <GlassCircleButton icon="ellipsis" label="More" testID="deckHeaderMore" diameter={deckChromeLayout.headerCircle} dark={theme.dark} onPress={showMore} />
    </View>
  );
}

function IncognitoPill({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      testID="deckIncognitoPill"
      accessibilityRole="button"
      accessibilityLabel={`Incognito, ${count} ${count === 1 ? "tab" : "tabs"}`}
      accessibilityHint="Shows the option to close incognito tabs."
      onPress={onPress}
      style={styles.pillHit}
    >
      <View pointerEvents="none" style={[styles.pill, { backgroundColor: tabsInk.incognitoCard, borderRadius: capsule(deckChromeLayout.pillHeight) }]}>
        <Symbol name="eyes" size={deckChromeLayout.pillGlyph} color={deckChromeInk.pill} />
        <Text style={[font.subheadline, styles.count]}>{count}</Text>
      </View>
    </Pressable>
  );
}

const pillIn = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: deckChromeMotion.pillScale }] },
    animations: { opacity: withSpring(1, deckChromeMotion.pill), transform: [{ scale: withSpring(1, deckChromeMotion.pill) }] },
  };
};

const pillOut = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withSpring(0, deckChromeMotion.pill), transform: [{ scale: withSpring(deckChromeMotion.pillScale, deckChromeMotion.pill) }] },
  };
};

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, height: browseLayout.hitTarget, flexDirection: "row", alignItems: "center", gap: deckChromeLayout.headerGap },
  switcher: { flexShrink: 1 },
  spacer: { flex: 1 },
  fallback: { fontWeight: "600" },
  pillHit: { minHeight: browseLayout.hitTarget, justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: deckChromeLayout.pillSpacing, height: deckChromeLayout.pillHeight, paddingHorizontal: deckChromeLayout.pillPadding },
  count: { fontWeight: "600", fontVariant: ["tabular-nums"], color: deckChromeInk.pill },
});
