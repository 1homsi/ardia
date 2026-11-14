import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");
const { isConfigSettingKey } = await import("../settings/configAllowlist.ts");
const { openFromPage } = await import("./openFromPage.ts");
const { takePopupTabCounts } = await import("../telemetry/popupTabCounts.ts");

const S = () => useBrowser.getState();

test("pop-ups stay windows unless the switch is on, and config.json can set it", () => {
  assert.equal(DEFAULT_SETTINGS.popupsOpenAsTabs, false);
  assert.equal(isConfigSettingKey("popupsOpenAsTabs"), true);
});

test("a pop-up the engine hands over as a tab opens next to its page and is counted; a link tab is not", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const page = S().windows[w].tabIds[0];
  takePopupTabCounts();
  openFromPage({ url: "https://a.example/popup", disposition: "foreground", popup: true }, { windowId: w, profileId: S().windows[w].profileId, tabId: page });
  openFromPage({ url: "https://a.example/link", disposition: "foreground", linkWait: "matched" }, { windowId: w, profileId: S().windows[w].profileId, tabId: page });
  const urls = S().windows[w].tabIds.map((id) => S().tabs[id].url);
  assert.ok(urls.includes("https://a.example/popup"));
  assert.deepEqual(takePopupTabCounts(), { popups_opened_as_tabs: 1 });
});
