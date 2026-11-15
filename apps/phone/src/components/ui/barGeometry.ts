import { Platform } from "react-native";
import { deckBarCenterFromBottom } from "../../lib/deckGeometry";
import type { Design } from "../../lib/design";
import { appDesign } from "./design";
import { browseLayout, floatingBarLayout } from "./tokens";

export const pageBarCenterFromBottom = (navigationInset: number, os: string) =>
  os === "android" ? Math.max(browseLayout.barCenterFromBottom, navigationInset + browseLayout.hitTarget / 2) : browseLayout.barCenterFromBottom;

export const floatingBarCenterFromBottom = () => floatingBarLayout.bottomGap + floatingBarLayout.control / 2;

export const barCenterFromBottom = (navigationInset: number, design: Design = appDesign) =>
  design === "redesigned" ? floatingBarCenterFromBottom() : pageBarCenterFromBottom(navigationInset, Platform.OS);

export const barHeight = (navigationInset: number, design: Design = appDesign) =>
  design === "redesigned" ? browseLayout.barHeight : browseLayout.barHeight + (barCenterFromBottom(navigationInset, design) - browseLayout.barCenterFromBottom);

export const deckCenterFromBottom = (navigationInset: number) => deckBarCenterFromBottom(navigationInset, Platform.OS);
