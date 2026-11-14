import { clipboard, type ClipboardOffer } from "@ardia/phone-native";
import { getStringAsync, hasStringAsync, setStringAsync } from "expo-clipboard";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AndroidHaptics, impactAsync, ImpactFeedbackStyle, notificationAsync, NotificationFeedbackType, performAndroidHapticsAsync, selectionAsync } from "expo-haptics";
import { getLocales } from "expo-localization";
import { Linking, Platform, Share } from "react-native";

export const copyText = (text: string) => setStringAsync(text);

export const shareLink = (url: string, title: string) => Share.share({ message: url, url, title });

export const openExternal = (url: string) => Linking.openURL(url);

export const preferredLanguage = () => getLocales()[0]?.languageCode ?? "en";

export const tapHaptic = () => impactAsync(ImpactFeedbackStyle.Light);

export const pressHaptic = () => impactAsync(ImpactFeedbackStyle.Medium);

export const successHaptic = () => notificationAsync(NotificationFeedbackType.Success);

const ANDROID_SEGMENT_TICK = 34;

export const selectionHaptic = () =>
  Platform.OS === "android"
    ? performAndroidHapticsAsync(Number(Platform.Version) >= ANDROID_SEGMENT_TICK ? AndroidHaptics.Segment_Tick : AndroidHaptics.Clock_Tick)
    : selectionAsync();

export const confirmHaptic = () => (Platform.OS === "android" ? performAndroidHapticsAsync(AndroidHaptics.Confirm) : impactAsync(ImpactFeedbackStyle.Light));

export const shareText = (text: string, title: string) => Share.share({ message: text, title });

export const pasteText = () => getStringAsync();

const readsClipOffers = requireOptionalNativeModule("ArdiaPhoneClipboard") !== null;

export async function clipboardOffer(): Promise<ClipboardOffer | null> {
  if (readsClipOffers) return clipboard.offer();
  return (await hasStringAsync()) ? "text" : null;
}
