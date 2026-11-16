import { memo, useMemo } from "react";
import { Animated, Pressable, View } from "react-native";
import { errorText, manualRefresh, statusText } from "../../state/live/engine";
import { folderRows, type FolderRow } from "../../state/live/rows";
import { updateFolder, useLive } from "../../state/live/store";
import type { LiveItem } from "../../state/live/types";
import { usePageProfileId, useTab } from "../../state/browser/hooks";
import { useLiveActiveTab, useLiveStrays } from "../../state/sidebar/hooks";
import { openSettings } from "../../state/settings/settingsWindows";
import { noteLiveFolderToggle } from "../../state/telemetry/liveHides";
import { HoverSlot } from "../ui/HoverSlot";
import { Button, ContextMenuArea, Dot, FadeLabel, ink, space, Symbol, Text, useHover, withAlpha } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { TabRow } from "./TabRow";
import { Fold, useFold, type FoldEntry } from "./Fold";
import { GROUP_BORDER, GROUP_INDENT, GROUP_INNER_RADIUS, GROUP_INSET, GROUP_RADIUS, groupMembersPadBottom } from "./geometry";
import { useDragFolded, useDragItem } from "./DragProvider";
import { dismissHover } from "../../state/sidebar/hover";
import { useGroupHover } from "./hoverController";
import { useGroupBoxOpacity } from "./hoverMotion";
import { openLiveFolderMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { FolderOrIcon } from "./AnimatedFolder";
import { groupBoxAtRest, groupSurface, SIDEBAR_TYPE, TAB_ROW, TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { RefreshSpinner } from "./RefreshSpinner";
import { SidebarRowSurface } from "./SidebarRow";
import { MoreRow, NoteRow, SectionTitle, StackRow } from "./LiveFolderRows";
import { LiveItemRow } from "./LiveItemRow";
import { CompletedFooter, useCompletedShown } from "./CompletedFooter";
import { entryKey } from "../../state/sidebar/entryKey";
import { GROUP_MEMBERS_PAD_BOTTOM } from "../../lib/sidebarMetrics";

const EMPTY: LiveItem[] = [];
const NONE: string[] = [];
const MEASURE_LABEL = { opacity: 0, fontVariant: TABULAR_NUMS } as const;

export const LiveFolderBlock = memo(function LiveFolderBlock({ folderId, windowId }: { folderId: string; windowId: string }) {
  const tokens = useSidebarTokens();
  const folder = useLive((s) => s.folders[folderId]);
  const items = useLive((s) => s.items[folderId] ?? EMPTY);
  const showAll = useLive((s) => s.showAll);
  const folded = useDragFolded(entryKey("live", folderId));
  const collapsed = folded || !!folder?.collapsed;
  const rows = useMemo(() => (folder ? folderRows(folder, items, showAll) : []), [folder, items, showAll]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const hiddenList = useLive((s) => s.hidden[folderId] ?? EMPTY);
  const repoHiddenList = useLive((s) => s.repoHidden[folderId] ?? EMPTY);
  const hiddenIds = useMemo(() => new Set([...hiddenList, ...repoHiddenList].map((i) => i.id)), [hiddenList, repoHiddenList]);
  const profileId = usePageProfileId();
  const strays = useLiveStrays(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeTab = useLiveActiveTab(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeItem = useTab(activeTab ?? undefined, (t) => t?.liveItem?.itemId ?? null);
  const completed = useCompletedShown(folderId).length > 0;
  const fold = useFold(collapsed);
  const box = useGroupHover(windowId, `livefolder|${folderId}`);
  const boxOpacity = useGroupBoxOpacity(box.hovered || groupBoxAtRest(folder?.color));
  const foldedHeight = () => GROUP_BORDER * 2 + layout.rowHeight + (activeTab ? layout.rowHeight + GROUP_MEMBERS_PAD_BOTTOM : 0);
  const { wrapper, handle, headerRef } = useDragItem(entryKey("live", folderId), { kind: "live", tabIds: NONE, section: "pinnedGroups", liveFolderId: folderId, collapsed: !!folder?.collapsed, foldedHeight });
  if (!folder) return null;
  const { fill, stroke } = groupSurface(folder.color, tokens);

  const entries: FoldEntry[] = rows.length
    ? rows.map((row) => ({ key: row.key, node: <FolderRowView row={row} folderId={folderId} windowId={windowId} /> }))
    : [{ key: "note", node: <FolderNote folderId={folderId} /> }];
  for (const id of strays) entries.push({ key: `stray:${id}`, node: <TabRow tabId={id} /> });
  if (completed) entries.push({ key: "completed", node: <CompletedFooter folderId={folderId} windowId={windowId} /> });
  const keep = !activeTab
    ? null
    : strays.includes(activeTab)
      ? `stray:${activeTab}`
      : (rows.find((r) => (r.kind === "item" && r.item.id === activeItem) || (r.kind === "stack" && r.items.some((i) => i.id === activeItem)))?.key ?? null);
  const shown = collapsed ? (keep ? 1 : 0) : entries.length;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View {...box.hoverProps} style={{ paddingVertical: GROUP_BORDER }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, opacity: boxOpacity }}
        />
        <View ref={headerRef} {...handle}>
          <FolderHeader folderId={folderId} windowId={windowId} collapsed={collapsed} open={fold.open} />
        </View>
        <Fold fold={fold} collapsed={collapsed} entries={entries} keep={keep} padBottom={groupMembersPadBottom(shown)} indent={GROUP_INDENT} indentEnd={GROUP_INSET} />
      </View>
    </Animated.View>
  );
});

function FolderRowView({ row, folderId, windowId }: { row: FolderRow; folderId: string; windowId: string }) {
  switch (row.kind) {
    case "header":
      return <SectionTitle title={row.title} />;
    case "more":
      return <MoreRow folderId={folderId} section={row.section} count={row.count} />;
    case "stack":
      return <StackRow folderId={folderId} windowId={windowId} stack={row} />;
    case "item":
      return <LiveItemRow folderId={folderId} item={row.item} windowId={windowId} />;
  }
}

function FolderNote({ folderId }: { folderId: string }) {
  const status = useLive((s) => s.status[folderId]);
  const kind = useLive((s) => s.folders[folderId]?.kind);
  const hidden = useLive((s) => s.hidden[folderId]?.length ?? 0);
  if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return <NoteRow text="Loading…" spinner />;
  if (status.error) return <NoteRow text={errorText(status.error.kind, status.error.source)} onPress={() => openSettings("liveFolders")} icon="exclamationmark.triangle.fill" />;
  if (hidden) return <NoteRow text={`${hidden} hidden until you refresh`} onPress={() => void manualRefresh(folderId)} />;
  return <NoteRow text={kind === "pullRequests" ? "No open pull requests" : "No recent documents"} />;
}

function FolderHeader({ folderId, windowId, collapsed, open }: { folderId: string; windowId: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const folder = useLive((s) => s.folders[folderId]);
  const unread = useLive((s) => (s.unread[folderId]?.length ?? 0) > 0);
  const status = useLive((s) => s.status[folderId]);
  const { hovered, hoverProps } = useHover();
  if (!folder) return null;
  const updating = status?.state === "updating" || status?.state === "initializing";

  return (
    <View ref={(v) => registerRow(windowId, `livefolder|${folderId}`, v)} {...hoverProps}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openLiveFolderMenu(windowId, folderId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            noteLiveFolderToggle();
            updateFolder(folderId, { collapsed: !collapsed });
          }}
        >
          {() => (
            <SidebarRowSurface fill={ink.clear} cornerRadius={GROUP_INNER_RADIUS}>
              <FolderOrIcon icon={folder.icon} open={!collapsed} color={folder.color} />
              <View style={{ flex: 1, height: TAB_ROW.titleHeight, marginLeft: TAB_ROW.titleGap, flexDirection: "row", alignItems: "center" }}>
                <View style={{ flexShrink: 1, height: TAB_ROW.titleHeight, paddingRight: space.m, justifyContent: "center" }}>
                  <Text lines={1} weight="medium" style={MEASURE_LABEL}>
                    {folder.name}
                  </Text>
                  <FadeLabel text={folder.name} fontSize={SIDEBAR_TYPE.title} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: TAB_ROW.titleHeight }} />
                </View>
                <Animated.View
                  style={{
                    width: 10,
                    height: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                  }}
                >
                  <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
                </Animated.View>
              </View>
              {status?.error ? (
                <Pressable onPress={() => openSettings("liveFolders")} tooltip={errorText(status.error.kind, status.error.source)} style={{ marginRight: space.xxs }}>
                  <Symbol name="exclamationmark.triangle.fill" size={10} color={colors.pending} style={{ width: 18, height: 18 }} />
                </Pressable>
              ) : null}
              <HoverSlot
                hovered={hovered && !updating}
                hover={<RefreshButton spinning={false} tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />}
              >
                {updating ? (
                  <RefreshButton spinning tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />
                ) : collapsed && unread ? (
                  <View style={{ marginRight: space.xs }}>
                    <Dot size={7} color={theme.accent} />
                  </View>
                ) : null}
              </HoverSlot>
            </SidebarRowSurface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function RefreshButton({ spinning, tooltip, onPress }: { spinning: boolean; tooltip: string; onPress(): void }) {
  const theme = useTheme();
  if (!spinning) return <Button variant="icon" icon="arrow.clockwise" size="s" weight="semibold" onPress={onPress} tooltip={tooltip} />;
  return (
    <View tooltip={tooltip} style={{ width: TAB_ROW.closeSlot, height: TAB_ROW.closeSlot, alignItems: "center", justifyContent: "center" }}>
      <RefreshSpinner>
        <Symbol name="arrow.clockwise" size={10} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
      </RefreshSpinner>
    </View>
  );
}
