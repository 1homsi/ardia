import { SidebarHeaderTools as NavigationTools } from "../../browser/src/components/sidebar/AddressBar";
import { useSidebarCaptionRoom } from "../../browser/src/state/windows/layout";
import { useMenuBesideWindowButtons } from "./sidebarHeaderLayout";
import { HEADER_TOOLS } from "../../browser/src/components/window/dockMotion";
import { ProfileIndicator, useProfileIndicatorWidth } from "./ProfileIndicator";
import { INDICATOR_GAP, sidebarHeaderSplit } from "./profileIndicatorLayout";

export { SidebarAddressRow } from "../../browser/src/components/sidebar/AddressBar";

const TOGGLE_ONLY = HEADER_TOOLS.fullScreenToggleX + 16;

export function SidebarHeaderTools({ width }: { width: number }) {
  const captionRoom = useSidebarCaptionRoom();
  const indicator = useProfileIndicatorWidth(Math.max(0, width - captionRoom - TOGGLE_ONLY - INDICATOR_GAP));
  const menuInHeader = !useMenuBesideWindowButtons();
  const { navigation, indicatorRoom } = sidebarHeaderSplit({ width, captionRoom, indicator, toggleOnly: TOGGLE_ONLY, menuInHeader });
  return (
    <>
      <NavigationTools width={navigation + captionRoom} />
      <div style={{ position: "absolute", left: navigation + 2, top: 7 }}>
        <ProfileIndicator room={indicatorRoom} />
      </div>
    </>
  );
}
