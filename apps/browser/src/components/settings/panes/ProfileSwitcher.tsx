import { Box, ContextMenuArea, Divider, radius, space, Symbol, Text, useHover } from "../../ui";
import { hapticTick } from "../../../state/app/system";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { hex, useTheme } from "../../ui/theme";
import { useProfileOrder, useProfileRecords } from "../../../state/profiles/hooks";
import { currentProfileOrder } from "../../../state/browser/current";
import { reorderProfiles } from "../../../state/profiles/actions";
import { useProfile, useSettings } from "../../../state/browser/hooks";
import { sharingProfiles } from "../../../state/profiles/profiles";
import { ProfileBadge } from "../../profiles/ProfileIcons";
import { replaceSettingsPlace, SETTINGS_WINDOW_ID } from "../../../state/settings/settingsWindows";
import { openProfileItemMenu } from "../../profiles/profileMenu";
import { curve } from "../../ui/motion";
import { settingsMotion } from "../tokens";

export const listOf = (names: string[], joiner = "and") => (names.length <= 2 ? names.join(` ${joiner} `) : `${names.slice(0, -1).join(", ")}, ${joiner} ${names.at(-1)}`);

export function useSharedWith(profileId: string): string[] {
  const order = useProfileOrder();
  const profiles = useProfileRecords();
  return useMemo(() => {
    const others = sharingProfiles({ profiles, profileOrder: order }, profileId);
    return others.length ? order.filter((id) => id === profileId || others.includes(id)) : [profileId];
  }, [order, profiles, profileId]);
}

const ROW_HEIGHT = 46;
const settle = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: settingsMotion.profileRowSettle, easing: curve.enter, useNativeDriver: true });

export function ProfileSwitcher({ selectedId }: { selectedId: string }) {
  const order = useProfileOrder();
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const offsetOf = (id: string) => {
    let v = offsets.get(id);
    if (!v) offsets.set(id, (v = new Animated.Value(0)));
    return v;
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef({ id: "", from: 0, to: 0, reorderPending: false });

  useLayoutEffect(() => {
    if (!drag.current.reorderPending) return;
    drag.current.reorderPending = false;
    offsets.forEach((v) => v.setValue(0));
  }, [order]);

  const controller = useRef({
    start(id: string) {
      const ids = currentProfileOrder();
      const from = ids.indexOf(id);
      drag.current = { id, from, to: from, reorderPending: false };
      setDragging(id);
    },
    move(dy: number) {
      const { id, from } = drag.current;
      const ids = currentProfileOrder();
      const max = ids.length - 1;
      offsetOf(id).setValue(Math.max(-from * ROW_HEIGHT - 6, Math.min((max - from) * ROW_HEIGHT + 6, dy)));
      const to = Math.max(0, Math.min(max, Math.round(from + dy / ROW_HEIGHT)));
      if (to === drag.current.to) return;
      drag.current.to = to;
      hapticTick();
      ids.forEach((other, j) => {
        if (other === id) return;
        settle(offsetOf(other), from < j && j <= to ? -ROW_HEIGHT : to <= j && j < from ? ROW_HEIGHT : 0).start();
      });
    },
    end(commit: boolean) {
      const { id, from, to } = drag.current;
      setDragging(null);
      if (!commit || from === to) {
        offsets.forEach((v) => settle(v, 0).start());
        return;
      }
      const ids = currentProfileOrder().filter((x) => x !== id);
      ids.splice(to, 0, id);
      drag.current.reorderPending = true;
      reorderProfiles(ids);
    },
  }).current;

  return (
    <Box fill="groupFill" border="groupBorder" radius="panel">
      {order.map((id, i) => (
        <ProfileRow
          key={id}
          profileId={id}
          selected={id === selectedId}
          first={i === 0}
          last={i === order.length - 1}
          offset={offsetOf(id)}
          lifted={dragging === id}
          controller={controller}
        />
      ))}
    </Box>
  );
}

type DragController = { start(id: string): void; move(dy: number): void; end(commit: boolean): void };

function ProfileRow({
  profileId,
  selected,
  first,
  last,
  offset,
  lifted,
  controller,
}: {
  profileId: string;
  selected: boolean;
  first: boolean;
  last: boolean;
  offset: Animated.Value;
  lifted: boolean;
  controller: DragController;
}) {
  const theme = useTheme();
  const profile = useProfile(profileId, (p) => p);
  const isDefault = useSettings((s) => s.defaultProfileId === profileId);
  const shared = useSharedWith(profileId);
  const names = useProfileRecords(useShallow((profiles) => shared.filter((id) => id !== profileId).map((id) => profiles[id]?.name ?? "")));
  const { hovered, hoverProps } = useHover();
  const badge = useRef<View>(null);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => controller.start(profileId),
      onPanResponderMove: (_, g) => controller.move(g.dy),
      onPanResponderRelease: () => controller.end(true),
      onPanResponderTerminate: () => controller.end(false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  if (!profile) return null;

  const cardInnerRadius = radius.panel - StyleSheet.hairlineWidth * 2;
  const description = [isDefault ? "Default" : null, names.length ? `Shares data with ${listOf(names)}` : null].filter(Boolean).join(" · ");
  const openMenu = () => openProfileItemMenu(profileId, "settings", SETTINGS_WINDOW_ID, badge.current);

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        zIndex: lifted ? 1 : 0,
        transform: [{ translateY: offset }],
        borderRadius: lifted ? radius.tile : 0,
        backgroundColor: lifted ? hex(theme.panel) : undefined,
        borderWidth: lifted ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: theme.groupBorder,
      }}
    >
      {!first && !lifted && <Divider inset="l" thick />}
      <ContextMenuArea onContextMenu={() => void openMenu()}>
        <View {...hoverProps}>
          <Pressable onPress={() => !selected && replaceSettingsPlace(profileId)} accessibilityRole="button" accessibilityState={{ selected }}>
            <View
              style={{
                height: ROW_HEIGHT - (first ? 0 : StyleSheet.hairlineWidth * 2),
                paddingLeft: space.m,
                paddingRight: space.l,
                flexDirection: "row",
                alignItems: "center",
                gap: space.ml,
                borderTopLeftRadius: first ? cardInnerRadius : 0,
                borderTopRightRadius: first ? cardInnerRadius : 0,
                borderBottomLeftRadius: last ? cardInnerRadius : 0,
                borderBottomRightRadius: last ? cardInnerRadius : 0,
                backgroundColor: hovered && !lifted && !selected ? theme.rowHover : undefined,
              }}
            >
              <View tooltip="Drag to reorder">
                <Symbol name="line.3.horizontal" size={11} color={theme.textTertiary} style={GRIP} />
              </View>
              <View ref={badge} collapsable={false}>
                <ProfileBadge profile={profile} />
              </View>
              <View style={{ flex: 1 }}>
                <Text weight={selected ? "semibold" : undefined}>{profile.name}</Text>
                {description ? (
                  <Text size="caption" tone="textSecondary" style={DESCRIPTION}>
                    {description}
                  </Text>
                ) : null}
              </View>
              {selected ? <Symbol name="checkmark" size={12} weight="semibold" color={theme.formAccent} style={CHECK} /> : null}
            </View>
          </Pressable>
        </View>
      </ContextMenuArea>
    </Animated.View>
  );
}

const GRIP = { width: 14, height: 14 } as const;
const CHECK = { width: 14, height: 14 } as const;
const DESCRIPTION = { marginTop: space.xxs } as const;
