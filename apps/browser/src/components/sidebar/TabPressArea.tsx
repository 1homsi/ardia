import type { ReactNode } from "react";
import { Animated, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { hostOf } from "@ardia/core";
import { useSettings } from "../../state/browser/hooks";
import { tabTitle } from "../../state/browser/model";
import type { Tab } from "../../state/browser/types";
import { middleClickTab } from "../../state/sidebar/clearTabs";
import { dismissHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { clickHeldTabPress, holdTabPress } from "../../state/sidebar/heldTabPress";
import { ContextMenuArea, MouseArea } from "../ui";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";

const SQUISH = { row: buttonMotion.rowPressScale, tile: buttonMotion.tilePressScale } as const;

export function TabPressArea({
  windowId,
  tab,
  style,
  pressStyle,
  tooltip,
  squish,
  children,
}: {
  windowId: string;
  tab: Tab;
  style?: StyleProp<ViewStyle>;
  pressStyle?: StyleProp<ViewStyle>;
  tooltip?: string;
  squish?: keyof typeof SQUISH;
  children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}) {
  const plainTooltip = useSettings((s) => !s.showTabHoverMenu);
  const pressMotion = usePressScaleMotion(!!squish, squish ? SQUISH[squish] : undefined);
  const scale = pressMotion.scale;
  return (
    <MouseArea onMiddleClick={() => middleClickTab(tab.id)} style={style}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openTabMenu(windowId, tab);
        }}
        style={style}
      >
        <Pressable
          onPressIn={(e) => {
            pressMotion.onPressIn?.();
            holdTabPress(windowId, tab.id, e);
          }}
          onPressOut={pressMotion.onPressOut}
          onPress={(e) => clickHeldTabPress(windowId, tab.id, e)}
          style={pressStyle}
          tooltip={tooltip ?? (plainTooltip ? titleTooltip(tab) : undefined)}
        >
          {scale ? (state) => <Animated.View style={{ transform: [{ scale }] }}>{typeof children === "function" ? children(state) : children}</Animated.View> : children}
        </Pressable>
      </ContextMenuArea>
    </MouseArea>
  );
}

function titleTooltip(tab: Tab): string {
  const host = tab.url ? hostOf(tab.url) : "";
  return host ? `${tabTitle(tab)}\n${host}` : tabTitle(tab);
}
