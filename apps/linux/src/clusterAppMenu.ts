import { menuShown } from "./menus";
import { openAppMenu } from "./AppMenuButton";
import { createClusterMenu } from "./clusterMenu";

export const showAppMenu = createClusterMenu(typeof window === "undefined" ? null : window, openAppMenu, menuShown, () => (typeof document === "undefined" ? null : document.activeElement));
