import { SidebarHeaderTools as NavigationTools } from "../../browser/src/components/sidebar/AddressBar";
import { useSidebarCaptionRoom } from "../../browser/src/state/windows/layout";
import { ProfileIndicator } from "./ProfileIndicator";

export { SidebarAddressRow } from "../../browser/src/components/sidebar/AddressBar";

export function SidebarHeaderTools({ width }: { width: number }) {
  const captionRoom = useSidebarCaptionRoom();
  const room = width - captionRoom;
  const navigationWidth = captionRoom ? Math.min(room, Math.max(114, room - 136)) : Math.max(114, width - 136);
  return (
    <>
      <NavigationTools width={navigationWidth + captionRoom} />
      <div style={{ position: "absolute", left: navigationWidth + 2, top: 7 }}>
        <ProfileIndicator room={Math.max(captionRoom ? 0 : 36, room - navigationWidth - 9)} />
      </div>
    </>
  );
}
