import { Platform } from "react-native";
import { addLinkListener, initialLink, type SystemLink } from "../../platform/links";
import { openPage, openSpaces, openTab, reopenArchived, searchFor, showDeck, useBrowse } from "../browse/store";
import { readArchivedTab } from "../store/browserDatabase";
import { browserDatabase } from "../store/database";
import { useOnboarding } from "../onboarding/store";
import { closeFind, closePageMenu, closeReader } from "../page/actions";
import { settled } from "../pages/store";
import { dismissSearch, presentSearch, searchState } from "../search/store";
import { closeSettings, openSettings } from "../settings/nav";
import { applyInbox } from "../sync/actions";
import { syncData } from "../sync/store";
import { canSearchByVoice, closeVoiceSearch, presentVoiceSearch } from "../voice/store";
import { currentTabs, setIncognito, useTabs } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { serialQueue } from "../../lib/serialQueue";
import { heldLinks, holdLink, takeHeldLinks } from "./heldLinks";
import { ALL_COVERS, coversToClose, heldAfterOnboarding, linkAction, type Cover, type IncomingLink } from "./linkRules";

let started = false;

const CLOSE: Record<Cover, () => void> = {
  tray: dismissSearch,
  voice: closeVoiceSearch,
  sheet: () => useBrowse.setState({ sheet: null }),
  settings: closeSettings,
  pageMenu: closePageMenu,
  reader: closeReader,
  find: closeFind,
};

function close(covers: readonly Cover[]) {
  for (const cover of covers) CLOSE[cover]();
}

async function run(link: IncomingLink) {
  const action = linkAction(link, {
    onboarding: useOnboarding.getState().showing,
    syncEnabled: syncData().status.isEnabled,
    canSearchByVoice: canSearchByVoice(),
    sharesAsShare: Platform.OS === "ios",
    tabKind: (id) => {
      const open = findTab(currentTabs(), id);
      if (open) return open.isPrivate ? "private" : "open";
      return readArchivedTab(browserDatabase(), id) ? "archived" : null;
    },
  });
  close(coversToClose(action));
  switch (action.kind) {
    case "hold":
      holdLink(link);
      return;
    case "openUrl":
      setIncognito(false);
      openPage(action.url, action.origin);
      return;
    case "searchNow":
      searchFor(action.query);
      return;
    case "tray": {
      const was = useTabs.getState().incognito;
      setIncognito(action.incognito);
      presentSearch(useBrowse.getState().surface === "start" ? "start" : "page", action.query, was);
      return;
    }
    case "voice": {
      const was = useTabs.getState().incognito;
      setIncognito(false);
      if (!searchState().open) presentSearch(useBrowse.getState().surface === "start" ? "start" : "page", "", was);
      presentVoiceSearch();
      return;
    }
    case "switchTab":
      openTab(action.id);
      return;
    case "restoreTab": {
      const tab = readArchivedTab(browserDatabase(), action.id);
      if (tab) reopenArchived(tab);
      return;
    }
    case "spaces":
      openSpaces();
      return;
    case "syncSettings":
      openSettings({ page: "sync" });
      return;
    case "inbox": {
      const opened = await applyInbox();
      if (opened <= 0 || useOnboarding.getState().showing) return;
      close(ALL_COVERS);
      void showDeck();
      return;
    }
    case "none":
      return;
  }
}

const inOrder = serialQueue();

const take = (link: SystemLink) => void inOrder(() => run(link));

let waiting: SystemLink[] | null = null;
let listening = false;

export function listenForLinks() {
  if (listening) return;
  listening = true;
  waiting = [];
  addLinkListener((link) => (waiting ? waiting.push(link) : take(link)));
}

export function startLinks() {
  if (started) return;
  started = true;
  listenForLinks();
  void settled(() => initialLink(), null).then((link) => {
    if (link) take(link);
    const queued = waiting ?? [];
    waiting = null;
    for (const later of queued) take(later);
  });
  useOnboarding.subscribe((state) => {
    if (state.showing || !heldLinks().length) return;
    for (const link of heldAfterOnboarding(takeHeldLinks())) void inOrder(() => run(link));
  });
}
