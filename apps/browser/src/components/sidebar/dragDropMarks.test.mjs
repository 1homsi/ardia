import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const D = await import("./fixtures/dragScene.mjs");
const { world, mixedScene, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { splitTabIdsOf } = await import("../../state/splits/splits.ts");
const { useToasts } = await import("../../state/app/toasts.ts");
const { pinGrid } = await import("./pinZone.ts");
const { useBrowser } = await import("../../state/browser/store.ts");
const { addToTileFolder, tileFolderOf } = await import("../../state/pins/tileFolders.ts");
const { S, entryKey, tailKey, mount, sceneLayout, readDrag, GAP, ROW, TILE } = D;

const frameOf = (m, key) => m.L.entries.find((e) => e.key === key).frame;
const at = (f, fx, fy) => ({ x: f.x + f.w * fx, y: f.y + f.h * fy });
const panes = () => Object.values(S().splits).map((v) => splitTabIdsOf(v));

async function dragOver(m, key, to, { splitView = true, select = null } = {}) {
  if (select) S().setSelection(m.w, select);
  const { c } = mount({ entries: m.L.entries, regions: m.regions });
  c.splitView = splitView;
  const f = frameOf(m, key);
  await c.begin(key, f.x + 20, f.y + 10);
  for (const p of [].concat(to)) c.move(p.x, p.y);
  return { c, ...readDrag(c) };
}

test("a single tab over the middle half of a row splits it on the half the pointer is on, with no line", async () => {
  for (const [fx, side] of [[0.2, "left"], [0.49, "left"], [0.51, "right"], [0.9, "right"]]) {
    const m = mixedScene();
    const b = entryKey("tab", m.id.b);
    const r = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, b), fx, 0.5));
    assert.deepEqual(r.drop, { type: "split", targetId: m.id.b, side }, `${fx}`);
    assert.deepEqual(r.marks.split, { key: b, side });
    assert.equal(r.marks.line, null);
    r.c.end(false);
  }
});

test("the top and bottom quarters of a row are insertion slots: a line between the rows, from the row's own edges", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const split = frameOf(m, entryKey("split", m.SP));
  const above = await dragOver(m, entryKey("tab", m.id.c), at(b, 0.5, 0.2));
  assert.deepEqual(above.drop.placement, { pinned: false, beforeId: m.id.b });
  assert.equal(above.marks.split, null);
  assert.deepEqual(above.marks.line, { x: b.x, y: b.y - GAP / 2, w: b.w });
  above.c.move(b.x + 40, b.y + b.h * 0.8);
  assert.deepEqual(readDrag(above.c).marks.line, { x: split.x, y: split.y - GAP / 2, w: split.w }, "below b: the slot before the split row");
  above.c.end(false);
});

test("the line follows the target's indent inside a group and sits under the last row at a list's end", async () => {
  const m = mixedScene();
  const g2 = frameOf(m, entryKey("tab", m.id.g2));
  const r = await dragOver(m, entryKey("tab", m.id.a), at(g2, 0.5, 0.15));
  assert.equal(r.drop.placement.groupId, m.G);
  assert.deepEqual(r.marks.line, { x: g2.x, y: g2.y - GAP / 2, w: g2.w });
  const tail = frameOf(m, tailKey("list"));
  r.c.move(60, tail.y + 20);
  assert.equal(readDrag(r.c).gapKey, tailKey("list"));
  assert.deepEqual(readDrag(r.c).marks.line, { x: tail.x, y: tail.y + GAP / 2, w: tail.w });
  r.c.end(false);
});

test("rows stay where they are: no row opens a gap and the dragged row keeps its place", async () => {
  const m = mixedScene();
  const r = await dragOver(m, entryKey("tab", m.id.c), [{ x: 60, y: 300 }, { x: 60, y: 160 }, { x: 60, y: 480 }]);
  assert.deepEqual(D.gaps(r.c), {});
  assert.deepEqual(r.marks.sources, [entryKey("tab", m.id.c)]);
  r.c.end(false);
});

test("a selection never splits: the middle of a row is a plain insertion slot", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, entryKey("tab", m.id.a), at(b, 0.7, 0.5), { select: [m.id.a, m.id.c] });
  assert.equal(r.drop.type, "tabs");
  assert.equal(r.marks.split, null);
  assert.ok(r.marks.line);
  r.c.end(false);
});

test("a group, a split row or a pinned row from another lane never splits a row", async () => {
  const b = (m) => at(frameOf(m, entryKey("tab", m.id.b)), 0.7, 0.5);
  for (const keyOf of [(m) => entryKey("group", m.G), (m) => entryKey("split", m.SP), (m) => entryKey("tab", m.id.p1)]) {
    const m = mixedScene();
    const r = await dragOver(m, keyOf(m), b(m));
    assert.notEqual(r.drop.type, "split", keyOf(m));
    assert.equal(r.marks.split, null);
    r.c.end(false);
  }
});

test("without split view the middle of a row reorders, and nothing groups", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, entryKey("tab", m.id.c), at(b, 0.7, 0.5), { splitView: false });
  assert.equal(r.drop.type, "tabs");
  assert.ok(r.marks.line);
  const groups = Object.keys(S().groups).length;
  r.c.end(true);
  await D.settle();
  assert.equal(Object.keys(S().groups).length, groups);
  assert.deepEqual(panes(), [[m.id.s1, m.id.s2]]);
});

test("a drop on a row's half makes a split there, the dragged tab on that side", async () => {
  for (const [fx, order] of [[0.25, (m) => [m.id.c, m.id.b]], [0.75, (m) => [m.id.b, m.id.c]]]) {
    const m = mixedScene();
    const r = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, entryKey("tab", m.id.b)), fx, 0.5));
    r.c.end(true);
    await D.settle();
    assert.ok(panes().some((p) => JSON.stringify(p) === JSON.stringify(order(m))), JSON.stringify(panes()));
    assert.equal(r.c.active, false);
  }
});

test("a split row takes a third pane on the side it is dropped, and a full one says so instead", async () => {
  const m = mixedScene();
  const sp = frameOf(m, entryKey("split", m.SP));
  const r = await dragOver(m, entryKey("tab", m.id.c), at(sp, 0.1, 0.5));
  assert.deepEqual(r.marks.split, { key: entryKey("split", m.SP), side: "left" });
  r.c.end(true);
  await D.settle();
  assert.deepEqual(splitTabIdsOf(S().splits[m.SP]), [m.id.c, m.id.s1, m.id.s2]);

  const full = mixedScene();
  S().openSplitPane(full.w, { tabId: full.id.a, anchorTabId: full.id.s2, side: "right" });
  const before = splitTabIdsOf(S().splits[full.SP]);
  assert.equal(before.length, 3);
  const r2 = await dragOver(full, entryKey("tab", full.id.c), at(frameOf(full, entryKey("split", full.SP)), 0.9, 0.5));
  assert.deepEqual(r2.marks.split?.side, "right");
  r2.c.end(true);
  await D.settle();
  assert.deepEqual(splitTabIdsOf(S().splits[full.SP]), before);
  assert.equal(useToasts.getState().toasts[full.w]?.title, "Cannot Add New Pane");
});

function tilesScene() {
  const W = world("a", "b", "t1", "t2");
  const { id } = W;
  S().pinTabs([id.t1, id.t2], true);
  const L = sceneLayout({ top: 60 });
  const grid = L.tiles([id.t1, id.t2]).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(id.a).row(id.b).tail("list");
  return { ...W, L, regions: { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) } };
}

test("a row over the Top Apps takes the shape of the tile it would become, and its row shape back when it leaves", async () => {
  const m = tilesScene();
  const t2 = frameOf(m, entryKey("tab", m.id.t2));
  const r = await dragOver(m, entryKey("tab", m.id.a), { x: t2.x + t2.w - 4, y: t2.y + TILE / 2 });
  assert.equal(r.marks.pins, true);
  assert.deepEqual(r.marks.tile, { w: pinGrid(3, m.regions.tiles.w).width, h: TILE });
  assert.equal(r.marks.line, null);
  r.c.move(60, frameOf(m, entryKey("tab", m.id.b)).y + ROW * 0.9);
  assert.equal(readDrag(r.c).marks.tile, null);
  assert.ok(readDrag(r.c).marks.line);
  r.c.end(false);

  const tile = await dragOver(tilesScene(), entryKey("tab", S().windows[Object.keys(S().windows)[0]].tabIds.find((id) => S().tabs[id].pin)), { x: t2.x + 4, y: t2.y + TILE / 2 });
  assert.equal(tile.marks.tile, null, "a tile dragged along the grid is already a tile");
  tile.c.end(false);
});

test("a Top Apps tile over the list takes the shape of a list row, and its tile shape back over the grid", async () => {
  const m = tilesScene();
  const t2 = entryKey("tab", m.id.t2);
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, t2, { x: b.x + 40, y: b.y + ROW * 0.85 });
  assert.equal(r.drop.type, "tabs");
  assert.ok(r.marks.line);
  assert.deepEqual(r.marks.row, { w: b.w, h: ROW });
  assert.equal(r.marks.tile, null);
  const grid = frameOf(m, entryKey("tab", m.id.t1));
  r.c.move(grid.x + 10, grid.y + TILE / 2);
  assert.equal(readDrag(r.c).marks.pins, true);
  assert.equal(readDrag(r.c).marks.row, null, "back over the grid it is a tile again");
  r.c.move(b.x + 40, b.y + ROW * 0.85);
  assert.deepEqual(readDrag(r.c).marks.row, { w: b.w, h: ROW });
  r.c.move(4000, b.y);
  assert.equal(readDrag(r.c).marks.row, null, "away from the sidebar there is no drop, so it stays a tile");
  r.c.end(false);
});

test("a row never takes a row mark, and a folder tile stays a folder", async () => {
  const m = tilesScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const row = await dragOver(m, entryKey("tab", m.id.a), { x: b.x + 40, y: b.y + ROW * 0.85 });
  assert.equal(row.marks.row, null);
  row.c.end(false);

  const W = world("a", "b", "t1", "t2", "t3");
  S().pinTabs([W.id.t1, W.id.t2, W.id.t3], true);
  useBrowser.setState(addToTileFolder(S(), [W.id.t3], W.id.t2), true);
  const folderId = tileFolderOf(S().tabs[W.id.t2]).id;
  const L = sceneLayout({ top: 60 });
  const cells = [W.id.t1, { folderId, members: [W.id.t2, W.id.t3] }];
  const grid = L.tiles(cells).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(W.id.a).row(W.id.b).tail("list");
  const fm = { ...W, L, regions: { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) } };
  const key = entryKey("tileFolder", folderId);
  const fb = frameOf(fm, entryKey("tab", W.id.b));
  const folder = await dragOver(fm, key, { x: fb.x + 40, y: fb.y + ROW * 0.85 });
  assert.notEqual(folder.drop.type, "none");
  assert.equal(folder.marks.row, null, "a folder tile keeps its folder look");
  folder.c.end(false);
});

test("a tile held over its own place never becomes a folder target, past the hold time too", async () => {
  const m = tilesScene();
  const home = frameOf(m, entryKey("tab", m.id.t1));
  const centre = { x: home.x + home.w / 2, y: home.y + TILE / 2 };
  const r = await dragOver(m, entryKey("tab", m.id.t1), [{ x: centre.x + 3, y: centre.y }, centre]);
  await new Promise((done) => setTimeout(done, 450));
  r.c.move(centre.x + 1, centre.y);
  const now = readDrag(r.c);
  assert.notEqual(now.drop.type, "folder");
  assert.notEqual(now.marks.folderTarget, entryKey("tab", m.id.t1));
  assert.notEqual(now.hold?.key, entryKey("tab", m.id.t1));
  r.c.end(false);
});
