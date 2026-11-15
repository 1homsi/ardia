import { shownPageTone, usePages, type PageState, type PageTone } from "../pages/store";
import { useBrowse } from "./store";

export const useSurface = () => useBrowse((s) => s.surface);

export const useSheet = () => useBrowse((s) => s.sheet);

export const useNavigation = <T>(id: string | null, select: (navigation: PageState | null) => T) =>
  usePages((s) => select(id ? s.navigation[id] ?? null : null));

export const usePageTone = (id: string | null): PageTone | null => usePages((s) => (id ? shownPageTone(s, id) : null));

export const useFrozenOrder = () => useBrowse((s) => s.frozenOrder);

export const useOpeningTab = () => useBrowse((s) => s.opening);

export const useLeavingTab = () => useBrowse((s) => s.leaving);
