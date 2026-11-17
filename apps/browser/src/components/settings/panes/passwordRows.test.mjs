import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mount } from "../../../test-hooks.mjs";

globalThis.__DEV__ = false;
const nodeRequire = createRequire(import.meta.url);
globalThis.require = (id) => (/\.png$/.test(id) ? { uri: id } : nodeRequire(id));

const native = await import("../../../test-native/ardiacore.ts");
const { useBrowser } = await import("../../../state/browser/store.ts");
const { usePasswordUnlocks } = await import("../../../state/site/savedPasswords.ts");
const { noteSettingsScroll, ROW_PAGE } = await import("../../../state/settings/growingRows.ts");
const { Row } = await import("../Form.tsx");
const { takeExportCounts } = await import("../../../state/telemetry/exportCounts.ts");
const { PasswordsPage } = await import("./ProfilePasswords.tsx");

const S = () => useBrowser.getState();
const flush = () => new Promise((r) => setImmediate(r));

function rowsIn(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => rowsIn(n, found));
  else if (node && typeof node === "object" && "props" in node) {
    if (node.type === Row && node.key?.includes("|user")) found.push(node.key);
    rowsIn(node.props.children, found);
  }
  return found;
}

function savedLogins(n) {
  const store = new Map();
  for (let i = 0; i < n; i++) store.set(`k${i}`, { origin: `https://site${i}.test`, url: `https://site${i}.test`, username: `user${i}`, password: "pw", created: i });
  native.passwordStores.set(native.current.device, store);
}

async function openPasswords(n) {
  S().hydrate({});
  S().createWindow({ url: "https://a.com/" });
  savedLogins(n);
  usePasswordUnlocks.setState({ unlocked: { "": true } });
  const page = mount(() => PasswordsPage({ profileId: S().settings.defaultProfileId }));
  await flush();
  await flush();
  return page;
}

test("unlocking thousands of saved passwords puts one page of rows on screen, and scrolling near the end adds the next page", async () => {
  takeExportCounts();
  const page = await openPasswords(5000);
  assert.equal(rowsIn(page.value).length, ROW_PAGE, "only the first page of rows is built");
  const counts = takeExportCounts();
  assert.equal(counts.password_list_shows, 1);
  assert.equal(counts.password_list_large_shows, 1);
  noteSettingsScroll(0, 800, 10_000);
  assert.equal(rowsIn(page.value).length, ROW_PAGE, "a scroll far from the end adds nothing");
  noteSettingsScroll(9_000, 800, 10_000);
  noteSettingsScroll(9_100, 800, 10_000);
  assert.equal(rowsIn(page.value).length, 2 * ROW_PAGE, "reaching the end adds one page, once per content height");
  noteSettingsScroll(19_000, 800, 20_000);
  assert.equal(rowsIn(page.value).length, 3 * ROW_PAGE);
});

test("a short list shows every row", async () => {
  const page = await openPasswords(40);
  assert.equal(rowsIn(page.value).length, 40);
});
