import { discardOffered, type OpenWindowRequest } from "../../platform/tabs";
import { focus, openWindow } from "../browser/actions";
import { engineProfile } from "../browser/model";
import { useBrowser } from "../browser/store";
import { isOpenRegularWindow } from "../windows/small";
import { asAdoptId } from "./adoptIds";
import { openFromPage } from "./openFromPage";

const BACKGROUND = new Set<OpenWindowRequest["disposition"]>(["background"]);

const dropOffered = (request: OpenWindowRequest) => {
  if (request.adoptId) void discardOffered(request.adoptId).catch(() => false);
};

export function openFromWindowlessPage(request: OpenWindowRequest, profile: string) {
  const s = useBrowser.getState();
  const profileId = s.profileOrder.find((id) => engineProfile(s, id) === profile);
  if (!profileId) return dropOffered(request);
  const windowId = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].find((id) => isOpenRegularWindow(s.windows[id]) && s.windows[id]!.profileId === profileId);
  if (windowId) {
    openFromPage(request, { windowId, profileId });
    if (!BACKGROUND.has(request.disposition)) focus(windowId);
    return;
  }
  if (request.disposition === "incognito") {
    dropOffered(request);
    return void openWindow({ kind: "private", url: request.url, profileId });
  }
  openWindow({ url: request.url, adoptId: asAdoptId(request.adoptId), profileId });
}
