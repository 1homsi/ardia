import type { ReactElement } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { closeFrontTab, recentTabs, switchToTab, tabTitle } from "../../state/browse/tabMenus";
import type { BrowserTab } from "../../state/tabs/tabModels";
import type { MenuItem } from "../ui";
import { MenuTrigger, nativeMenus } from "../ui/MenuTrigger";

export function tabsMenuItems(order: readonly BrowserTab[], showTabs?: () => void): MenuItem[] {
  const shows: MenuItem[] = showTabs ? [{ label: "Show Tabs", icon: "squareOnSquare", systemImage: "square.on.square", onPress: showTabs }] : [];
  const others = recentTabs(order).map((tab): MenuItem => ({ label: tabTitle(tab), onPress: () => switchToTab(tab.id) }));
  return [...shows, ...others, ...(others.length || showTabs ? ["divider" as const] : []), { label: "Close Tab", icon: "xmark", systemImage: "xmark", destructive: true, onPress: closeFrontTab }];
}

export type TabsMenuHandlers = { onLongPress?: () => void; screenReaderActions: { name: string; label: string; run: () => void }[] };

type TriggerProps = { order: readonly BrowserTab[]; onTabsMenu: () => void; onShowTabs?: () => void; testID?: string; style?: StyleProp<ViewStyle>; children: (handlers: TabsMenuHandlers) => ReactElement };

export function TabsMenuTrigger({ order, onTabsMenu, onShowTabs, testID = "tabsButtonMenu", style, children }: TriggerProps) {
  if (!nativeMenus()) return children({ onLongPress: onTabsMenu, screenReaderActions: [] });
  return (
    <MenuTrigger testID={testID} items={tabsMenuItems(order, onShowTabs)} trigger="longPress" style={style}>
      {() => children({ screenReaderActions: [{ name: "recentTabs", label: "Recent Tabs", run: onTabsMenu }] })}
    </MenuTrigger>
  );
}
