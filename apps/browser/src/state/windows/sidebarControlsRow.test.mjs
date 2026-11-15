import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { setUrlAnchor, sidebarControlsRow, useUrlAnchors, watchSidebarControlsRow } = await import("./layout.ts");
const windows = (await import("../../lib/platformChrome.windows.ts")).WINDOW_CHROME;
const { SIDEBAR_FIELD } = await import("../../components/sidebar/geometry.ts");

const S = () => useBrowser.getState();
const FIELD_LEFT = 10;

function sidebarField(windowId) {
  return {
    measureInWindow(done) {
      done(FIELD_LEFT, sidebarControlsRow(S(), windowId, windows) + SIDEBAR_FIELD.top, 170, SIDEBAR_FIELD.height);
    },
  };
}

const anchorField = (windowId, view) => view.measureInWindow((left, top, width, height) => setUrlAnchor(windowId, { left, top, width, sidebar: { height } }));

test("the address panel's anchor follows the sidebar field when the window buttons' row appears or goes, though the field's own layout never changes (#1973)", () => {
  S().hydrate({});
  S().updateSettings({ tabLayout: "sidebar", sidebarSide: "left", addressBar: "sidebar", autoHideTabs: false, minimalismMode: false, sidebarWidth: 190 });
  const id = S().createWindow({ url: "https://a.example/" });
  const field = sidebarField(id);
  const rows = [];
  const stop = watchSidebarControlsRow(id, (row) => (rows.push(row), anchorField(id, field)), windows);
  anchorField(id, field);
  const row = windows.trailingWidth ? 33 : 0;
  assert.equal(sidebarControlsRow(S(), id, windows), row);
  assert.equal(useUrlAnchors.getState()[id].top, SIDEBAR_FIELD.top + row, "with the row, the field starts below it");
  S().updateSettings({ minimalismMode: true });
  assert.deepEqual(rows, [0]);
  assert.equal(useUrlAnchors.getState()[id].top, SIDEBAR_FIELD.top, "Minimalism takes the row away and the anchor moves up with the field");
  S().updateSettings({ minimalismMode: false });
  assert.deepEqual(rows, [0, row]);
  assert.equal(useUrlAnchors.getState()[id].top, SIDEBAR_FIELD.top + row, "and back down when the row returns");
  S().updateSettings({ sidebarSide: "right" });
  S().updateSettings({ sidebarSide: "left" });
  assert.deepEqual(rows, [0, row, 0, row], "moving the sidebar to the right and back takes the row away and brings it back");
  S().updateSettings({ compactToolbar: true });
  S().newTab(id, { url: "https://b.example/" });
  assert.deepEqual(rows, [0, row, 0, row], "changes that leave the row as it is don't measure again");
  stop();
  S().updateSettings({ minimalismMode: true });
  assert.deepEqual(rows, [0, row, 0, row], "a stopped watch hears nothing");
});
