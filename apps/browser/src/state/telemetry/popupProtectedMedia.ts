import type { PopupProtectedMedia } from "../../platform/performance";

const FAMILIES = ["widevine", "playready", "fairplay", "other"] as const;
type Family = (typeof FAMILIES)[number];

const none = () => Object.fromEntries(FAMILIES.flatMap((family) => [[`${family}:listed`, 0], [`${family}:unlisted`, 0]])) as Record<string, number>;

let pending = none();

export function notePopupProtectedMedia(media: PopupProtectedMedia | undefined) {
  const family: Family = FAMILIES.find((candidate) => candidate === media?.family) ?? "other";
  const key = `${family}:${media?.listed === true ? "listed" : "unlisted"}`;
  pending[key] = (pending[key] ?? 0) + 1;
}

export function takePopupProtectedMediaCounts() {
  const taken = pending;
  pending = none();
  return {
    popup_protected_media_refused_widevine_listed: taken["widevine:listed"],
    popup_protected_media_refused_widevine_unlisted: taken["widevine:unlisted"],
    popup_protected_media_refused_playready_listed: taken["playready:listed"],
    popup_protected_media_refused_playready_unlisted: taken["playready:unlisted"],
    popup_protected_media_refused_fairplay_listed: taken["fairplay:listed"],
    popup_protected_media_refused_fairplay_unlisted: taken["fairplay:unlisted"],
    popup_protected_media_refused_other_listed: taken["other:listed"],
    popup_protected_media_refused_other_unlisted: taken["other:unlisted"],
  };
}
