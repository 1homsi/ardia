import { Platform } from "react-native";
import { deckBarCenterFromBottom } from "../../lib/deckGeometry";
import { browseLayout } from "./tokens";

export const pageBarCenterFromBottom = (navigationInset: number, os: string) =>
  os === "android" ? Math.max(browseLayout.barCenterFromBottom, navigationInset + browseLayout.hitTarget / 2) : browseLayout.barCenterFromBottom;

export const barCenterFromBottom = (navigationInset: number) => pageBarCenterFromBottom(navigationInset, Platform.OS);

export const barHeight = (navigationInset: number) =>
  browseLayout.barHeight + (barCenterFromBottom(navigationInset) - browseLayout.barCenterFromBottom);

export const deckCenterFromBottom = (navigationInset: number) => deckBarCenterFromBottom(navigationInset, Platform.OS);
