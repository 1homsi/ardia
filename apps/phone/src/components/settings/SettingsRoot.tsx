import { useEffect } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { refreshDefaultBrowser, useDefaultBrowser } from "../../state/settings/defaultBrowser";
import { offersDefaultBrowser } from "../../state/settings/settingsRules";
import { openArchive, openSpaces } from "../../state/browse/store";
import { matchMyMac } from "../../state/sync/actions";
import { useSyncEnabled, useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { syncedEngineName, syncRowSubtitle } from "../../state/sync/syncRules";
import { showOnboarding } from "../../state/onboarding/store";
import { appVersion, exportOpenTabs, setAppLinks, setArchiveInterval, setAutoOpenKeyboard, setColorChoice, setSearchSuggestions, useEngines } from "../../state/settings/actions";
import { usePreferences } from "../../state/settings/hooks";
import { closeSettings, pushSettings } from "../../state/settings/nav";
import { AUTO_ARCHIVE_INTERVALS, autoArchiveTitle, type AutoArchiveInterval } from "../../state/tabs/tabModels";
import { capsule, duration, settingsMotion, font, PROFILE_COLORS, settingsLayout, settingsTint, space, Symbol, useProfileLook, useTheme, type ProfileColor } from "../ui";
import { PHONE_SHARING_COPY } from "../../lib/telemetryCopy";
import { setUsageSharing, useUsageSharing } from "../../state/telemetry/telemetry";
import { BarButton, Group, IconTile, NavRow, PickerRow, SettingsPage, ToggleRow } from "./SettingsKit";

const APP_LINKS = [
  { id: "ardia" as const, title: "Ardia" },
  { id: "app" as const, title: "App" },
];

const INTERVALS = (Object.keys(AUTO_ARCHIVE_INTERVALS) as AutoArchiveInterval[]).map((id) => ({ id, title: autoArchiveTitle(id) }));

export function SettingsRoot() {
  const theme = useTheme();
  const engineId = usePreferences((p) => p.searchEngineId);
  const suggestions = usePreferences((p) => p.searchSuggestions);
  const keyboard = usePreferences((p) => p.autoOpensKeyboard);
  const interval = usePreferences((p) => p.autoArchiveInterval);
  const engines = useEngines((s) => s.engines);
  const appLinks = useEngines((s) => s.appLinks);
  const sharing = useUsageSharing((s) => s.sharing);
  const syncEnabled = useSyncEnabled();
  const offersDefault = offersDefaultBrowser(useDefaultBrowser((s) => s.status));
  useEffect(() => {
    void refreshDefaultBrowser();
  }, []);
  const synced = useSyncView().search;
  const engineName = syncEnabled && synced ? syncedEngineName(synced, engines) : (engines.find((engine) => engine.id === engineId)?.name ?? "");
  const stacks = useWindowDimensions().fontScale >= settingsLayout.accessibilityFontScale;
  return (
    <SettingsPage title="Settings" trailing={<BarButton title="Done" emphasized onPress={closeSettings} />}>
      <Group>
        <SyncCard stacks={stacks} />
      </Group>
      <View testID="settingsShortcuts" style={[styles.shortcuts, { flexDirection: stacks ? "column" : "row" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            closeSettings();
            openArchive();
          }}
          style={[styles.shortcut, stacks ? null : styles.fill, { backgroundColor: theme.groupFill }]}
        >
          <Symbol name="archivebox" size={20} color={theme.label} />
          <Text style={[font.body, styles.medium, { color: theme.label }]}>Archive</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            closeSettings();
            openSpaces();
          }}
          style={[styles.shortcut, stacks ? null : styles.fill, { backgroundColor: theme.groupFill }]}
        >
          <Symbol name="squareStack" size={20} color={theme.label} />
          <Text style={[font.body, styles.medium, { color: theme.label }]}>Spaces</Text>
        </Pressable>
      </View>
      <Group>
        <ColorRow />
        {syncEnabled ? <MatchMyMac /> : null}
      </Group>
      <Group>
        <NavRow title="Site Settings" icon="globe" tint={settingsTint.neutral} divider={offersDefault} onPress={() => pushSettings({ page: "siteSettings" })} />
        {offersDefault ? <NavRow title="Default Browser" icon="safariFill" tint={settingsTint.defaultBrowser} onPress={() => pushSettings({ page: "defaultBrowser" })} /> : null}
      </Group>
      <Group>
        <NavRow title="Search Engine" icon="magnifyingglass" tint={settingsTint.search} value={engineName} divider onPress={() => pushSettings({ page: "searchEngine" })} />
        <ToggleRow title="Search Suggestions" icon="textMagnifyingglass" tint={settingsTint.blue} value={suggestions} divider onChange={setSearchSuggestions} />
        <ToggleRow title="Auto-Open Keyboard" icon="keyboardFill" tint={settingsTint.keyboard} value={keyboard} onChange={setAutoOpenKeyboard} />
      </Group>
      <Group>
        <PickerRow title="Archive Inactive Tabs" icon="archivebox" tint={settingsTint.archive} options={INTERVALS} selected={interval} divider onSelect={setArchiveInterval} />
        <PickerRow title="Open App Links In" icon="arrowUpForwardAppFill" tint={settingsTint.appLinks} options={APP_LINKS} selected={appLinks} divider onSelect={setAppLinks} />
        <NavRow title="Clear Browsing Data" icon="eraserFill" tint={settingsTint.clearData} divider onPress={() => pushSettings({ page: "clearData" })} />
        <Pressable accessibilityRole="button" onPress={exportOpenTabs} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
          <IconTile icon="squareAndArrowUp" tint={settingsTint.export} />
          <Text style={[font.body, { color: theme.label }]}>Export Open Tabs</Text>
        </Pressable>
      </Group>
      <Group footer={PHONE_SHARING_COPY.summary}>
        <ToggleRow
          title={PHONE_SHARING_COPY.toggle}
          icon="checkmarkShield"
          tint={settingsTint.neutral}
          value={sharing}
          divider
          onChange={(on) => setUsageSharing(on, "settings")}
        />
        <NavRow title={PHONE_SHARING_COPY.whatsSent} icon="info" tint={settingsTint.neutral} onPress={() => pushSettings({ page: "whatsSent" })} />
      </Group>
      <Group>
        <Pressable accessibilityRole="button" onPress={showOnboarding} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
          <IconTile icon="handWave" tint={settingsTint.onboarding} />
          <Text style={[font.body, { color: theme.label }]}>Show Onboarding</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: theme.separator }]} />
        <NavRow title="About Ardia" icon="info" tint={settingsTint.neutral} onPress={() => pushSettings({ page: "about" })} />
      </Group>
      <Text style={[font.footnote, styles.centered, { color: theme.secondaryLabel }]}>{appVersion()}</Text>
    </SettingsPage>
  );
}

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

function SyncCard({ stacks }: { stacks: boolean }) {
  const theme = useTheme();
  const status = useSyncStatus();
  const line = syncRowSubtitle(status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sync With Mac"
      accessibilityValue={{ text: line.text }}
      onPress={() => pushSettings({ page: "sync" })}
      style={({ pressed }) => [styles.syncCard, pressed ? { backgroundColor: theme.rowHighlight } : null]}
    >
      <View testID="syncCardContent" style={[styles.fill, stacks ? styles.syncStacked : styles.syncBeside]}>
        <IconTile icon="macAndPhone" tint={settingsTint.sync} side={stacks ? settingsLayout.syncTileLarge : settingsLayout.syncTile} />
        <View style={styles.syncText}>
          <Text style={[font.title3, styles.bold, { color: theme.label }]}>Sync With Mac</Text>
          <LayoutAnimationConfig skipEntering>
            <Animated.Text
              key={line.text}
              testID="syncStatusLine"
              entering={FadeIn.duration(duration.crossfade)}
              exiting={FadeOut.duration(duration.crossfade)}
              style={[font.subheadline, { color: line.isWarning ? theme.destructive : theme.secondaryLabel }]}
              numberOfLines={stacks ? undefined : 2}
            >
              {line.text}
            </Animated.Text>
          </LayoutAnimationConfig>
        </View>
      </View>
      <Symbol name="chevronRight" size={14} color={theme.tertiaryLabel} />
    </Pressable>
  );
}

function MatchMyMac() {
  const theme = useTheme();
  const chosen = usePreferences((p) => p.colorChoice);
  const look = useProfileLook();
  return (
    <>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <ToggleRow title="Match My Mac" icon="laptop" tint={settingsTint.neutral} value={chosen === null} onChange={(on) => matchMyMac(on, look)} />
    </>
  );
}

function ColorRow() {
  const theme = useTheme();
  const look = useProfileLook();
  return (
    <View style={styles.colorRow}>
      <View style={styles.colorLabel}>
        <IconTile icon="paintpaletteFill" tint={look.swatch} />
        <Text style={[font.body, { color: theme.label }]}>Color</Text>
      </View>
      <View style={styles.swatches} accessibilityRole="radiogroup">
        {COLORS.map((color) => (
          <Swatch key={color} color={color} selected={color === look.preset} />
        ))}
      </View>
    </View>
  );
}

function Swatch({ color, selected }: { color: ProfileColor; selected: boolean }) {
  const swatch = PROFILE_COLORS[color].swatch;
  const ring = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    ring.value = withSpring(selected ? 1 : 0, settingsMotion.swatchRing);
  }, [selected, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={PROFILE_COLORS[color].name}
      accessibilityState={{ selected }}
      onPress={() => setColorChoice(color)}
      style={styles.swatchHit}
    >
      <View style={styles.ringBox}>
        <Animated.View testID="swatchRing" style={[StyleSheet.absoluteFill, styles.ring, { borderColor: swatch }, ringStyle]} />
        <View style={[styles.swatch, { backgroundColor: swatch }]} />
      </View>
    </Pressable>
  );
}

const RING = settingsLayout.swatch + (settingsLayout.swatchGap + settingsLayout.swatchRing) * 2;

const styles = StyleSheet.create({
  shortcuts: { paddingHorizontal: space.l, gap: space.s },
  fill: { flex: 1 },
  shortcut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.s, minHeight: 48, borderRadius: capsule(48) },
  medium: { fontWeight: "500" },
  bold: { fontWeight: "600" },
  syncCard: { flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.m },
  syncText: { flexShrink: 1, gap: space.tight },
  syncBeside: { flexDirection: "row", alignItems: "center", gap: space.s + 2 },
  syncStacked: { flexDirection: "column", alignItems: "flex-start", gap: space.s },
  row: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap, minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: settingsLayout.rowInset + settingsLayout.tile + settingsLayout.labelGap },
  centered: { textAlign: "center" },
  colorRow: { paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.m, gap: space.m },
  colorLabel: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap },
  swatches: { flexDirection: "row" },
  swatchHit: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  ringBox: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ring: { borderRadius: capsule(RING), borderWidth: settingsLayout.swatchRing },
  swatch: { width: settingsLayout.swatch, height: settingsLayout.swatch, borderRadius: capsule(settingsLayout.swatch) },
});
