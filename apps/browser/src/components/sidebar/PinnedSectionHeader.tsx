import { Animated, Pressable, View } from "react-native";
import { useProfile } from "../../state/browser/hooks";
import { PINNED_FOLD_TITLES, togglePinnedFold } from "../../state/sidebar/pinnedFold";
import { radius, Symbol, Text, useHover } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { TAB_ROW } from "./tokens";

export function PinnedSectionHeader({ profileId, collapsed, open }: { profileId: string; collapsed: boolean; open: Animated.Value }) {
  const name = useProfile(profileId, (profile) => profile?.name ?? "");
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = `${collapsed ? PINNED_FOLD_TITLES.expand : PINNED_FOLD_TITLES.collapse} · ${name}`;
  const rotate = open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] });
  return (
    <View {...hoverProps}>
      <Pressable focusable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !collapsed }} aria-expanded={!collapsed} onAccessibilityTap={() => togglePinnedFold(profileId)} onPress={() => togglePinnedFold(profileId)}>
        {({ pressed }) => (
          <View style={{ height: layout.rowHeight, borderRadius: radius.chrome, flexDirection: "row", alignItems: "center", paddingLeft: TAB_ROW.contentLeft, paddingRight: TAB_ROW.trailing, backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined }}>
            <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
              <Symbol name="chevron.down" size={9} weight="semibold" color={theme.textTab} style={{ width: 10, height: 10 }} />
            </Animated.View>
            <Text size="body" weight="medium" color={theme.textTab} lines={1} style={{ flex: 1, minWidth: 0, marginLeft: TAB_ROW.titleGap, textAlign: "left" }}>{name}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
