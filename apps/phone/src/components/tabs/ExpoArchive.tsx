import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformColor, StyleSheet, useWindowDimensions, View } from "react-native";
import { BottomSheet, Button, ConfirmationDialog, ContentUnavailableView, ContextMenu, Divider, HStack, Host, List, Menu, NavigationStack, Picker, RNHostView, Section, ShareLink, Spacer, Text, Toolbar, ToolbarItem, VStack, useNativeState } from "@expo/ui/swift-ui";
import { accessibilityElement, accessibilityHint, buttonStyle, disabled, font, foregroundStyle, frame, lineLimit, listStyle, navigationBarTitleDisplayMode, navigationTitle, padding, pickerStyle, searchable, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { ARCHIVE_SEARCH_DELAY_MS, archiveDayTitle } from "../../lib/archiveDay";
import { haptics } from "../../state/app/haptics";
import { closeArchive, useBrowse } from "../../state/browse/store";
import { canShareTab, copyTabLink, deleteArchivedTab, openArchivedTab } from "../../state/browse/tabMenus";
import { display } from "../../state/search/omnibox";
import { usePreferences } from "../../state/settings/hooks";
import { useArchiveDays, useArchiveLoaded } from "../../state/tabs/hooks";
import { clearArchivedTabs, loadArchive, searchArchive, setAutoArchiveInterval } from "../../state/tabs/store";
import { AUTO_ARCHIVE_INTERVALS, autoArchiveTitle, type AutoArchiveInterval, type BrowserTab } from "../../state/tabs/tabModels";
import { Favicon, modifierList, settingsChrome } from "../ui";

const SECONDARY = { type: "hierarchical", style: "secondary" } as const;
const FILL = Number.MAX_SAFE_INTEGER;
const ROW_FAVICON = 20;
const ROW_FAVICON_SCALE_CAP = 2;
const INTERVALS = Object.keys(AUTO_ARCHIVE_INTERVALS) as AutoArchiveInterval[];

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function ExpoArchiveSheet() {
  const open = useBrowse((s) => s.sheet === "archive");
  return (
    <Host testID="expoArchiveSheet" style={styles.anchor} pointerEvents="none">
      <BottomSheet isPresented={open} onIsPresentedChange={(presented) => (presented ? undefined : closeArchive())}>
        <ArchiveNavigation />
      </BottomSheet>
    </Host>
  );
}

function ArchiveNavigation() {
  const days = useArchiveDays();
  const loaded = useArchiveLoaded();
  const interval = usePreferences((p) => p.autoArchiveInterval);
  const searchText = useNativeState("");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  useEffect(() => loadArchive(), []);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearched("");
      return;
    }
    const wait = setTimeout(() => setSearched(trimmed), ARCHIVE_SEARCH_DELAY_MS);
    return () => clearTimeout(wait);
  }, [query]);
  const results = useMemo(() => (searched ? searchArchive(searched) : null), [searched, days]);
  const hasArchive = days.some((day) => day.tabs.length > 0);
  const now = Date.now();
  const page = modifierList(navigationTitle("Archive"), navigationBarTitleDisplayMode("inline"), tint(PlatformColor("systemBlue")), settingsChrome(), searchable(searchText, { placement: "navigationBarDrawer", prompt: "Search Archive", onChange: setQuery }));
  const content = !loaded ? (
    <List modifiers={page}>{null}</List>
  ) : !hasArchive ? (
    <ContentUnavailableView title="No Archived Tabs" systemImage="archivebox.fill" description="Closed and inactive tabs show up here." modifiers={page} />
  ) : results && !results.length ? (
    <ContentUnavailableView title={`No Results for “${searched}”`} systemImage="magnifyingglass" description="Check the spelling or try a new search." modifiers={page} />
  ) : (
    <List modifiers={modifierList(...page, listStyle("plain"))}>
      {results ? (
        <ArchiveRows tabs={results} />
      ) : (
        days.map((day) => (
          <Section key={day.tabs[0]!.id} title={archiveDayTitle(day.tabs[0]!.archivedAt ?? day.tabs[0]!.lastActive, now)}>
            <ArchiveRows tabs={day.tabs} />
          </Section>
        ))
      )}
    </List>
  );
  return (
    <NavigationStack>
      <Toolbar>
        <ConfirmationDialog title="Delete All Archived Tabs?" isPresented={confirmingClear} onIsPresentedChange={setConfirmingClear} titleVisibility="visible">
          <ConfirmationDialog.Trigger>{content}</ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button
              role="destructive"
              label="Delete All"
              onPress={() => {
                haptics.warning();
                clearArchivedTabs();
              }}
            />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>This can’t be undone.</Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
        <Toolbar.Content>
          <ToolbarItem placement="cancellationAction">
            <Button label="Done" onPress={closeArchive} />
          </ToolbarItem>
          <ToolbarItem placement="primaryAction">
            <Menu label="Options" systemImage="ellipsis">
              <Picker label="Archive Inactive Tabs" systemImage="archivebox" selection={interval} onSelectionChange={(next: AutoArchiveInterval) => setAutoArchiveInterval(next)} modifiers={[pickerStyle("menu")]}>
                {INTERVALS.map((option) => (
                  <Text key={option} modifiers={[tag(option)]}>
                    {autoArchiveTitle(option)}
                  </Text>
                ))}
              </Picker>
              <Divider />
              <Button label="Delete All…" systemImage="trash" role="destructive" onPress={() => setConfirmingClear(true)} modifiers={[disabled(!hasArchive)]} />
            </Menu>
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </NavigationStack>
  );
}

function ArchiveRows({ tabs }: { tabs: BrowserTab[] }) {
  const { fontScale } = useWindowDimensions();
  const iconSize = ROW_FAVICON * Math.min(fontScale, ROW_FAVICON_SCALE_CAP);
  const row = useCallback(({ item }: { item: BrowserTab }) => <ArchiveRow tab={item} iconSize={iconSize} />, [iconSize]);
  return (
    <List.ForEach data={tabs} keyExtractor={(tab) => tab.id} onDelete={(indices) => indices.forEach((index) => tabs[index] && deleteArchivedTab(tabs[index]))} estimatedItemSize={60}>
      {row}
    </List.ForEach>
  );
}

function ArchiveRow({ tab, iconSize }: { tab: BrowserTab; iconSize: number }) {
  const shown = display(tab.url);
  const restore = () => {
    haptics.selection();
    openArchivedTab(tab);
  };
  return (
    <ContextMenu>
      <ContextMenu.Trigger>
        <Button onPress={restore} modifiers={[buttonStyle("plain"), accessibilityHint("Reopens the tab.")]}>
          <HStack alignment="firstTextBaseline" spacing={12} modifiers={[padding({ vertical: 4 }), frame({ maxWidth: FILL, alignment: "leading" }), accessibilityElement("combine")]}>
            <RNHostView matchContents>
              <View style={{ width: iconSize, height: iconSize }}>
                <Favicon iconUrl={tab.faviconUrl} pageUrl={tab.url} size={iconSize} />
              </View>
            </RNHostView>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ textStyle: "body" }), lineLimit(2)]}>{tab.title || shown.host}</Text>
              <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(SECONDARY), lineLimit(1)]}>{`${shown.host} · ${time(tab.archivedAt ?? tab.lastActive)}`}</Text>
            </VStack>
            <Spacer />
          </HStack>
        </Button>
      </ContextMenu.Trigger>
      <ContextMenu.Items>
        <Button label="Open" systemImage="arrow.up.forward.square" onPress={restore} />
        {canShareTab(tab) ? <Button label="Copy Link" systemImage="link" onPress={() => copyTabLink(tab)} /> : null}
        {canShareTab(tab) ? <ShareLink item={tab.url}><Text>Share</Text></ShareLink> : null}
        <Divider />
        <Button label="Delete" systemImage="trash" role="destructive" onPress={() => deleteArchivedTab(tab)} />
      </ContextMenu.Items>
    </ContextMenu>
  );
}

const styles = StyleSheet.create({
  anchor: { position: "absolute", width: 0, height: 0 },
});
