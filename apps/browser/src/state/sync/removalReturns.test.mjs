import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
const downloading = new Set();
const unreadable = new Set();
let ids = 0;
let writes = 0;
let gate = null;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `id${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    enterPhrase: async () => ({ ok: true }),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      writes++;
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      if (gate && gate.scope === scope) {
        const held = gate;
        gate = null;
        held.reached();
        await held.released;
      }
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const unknown = here.map(([id]) => id).filter((id) => !known.includes(id));
      const files = here.filter(([id]) => unknown.includes(id) && !downloading.has(id) && !unreadable.has(id)).map(([id, f]) => ({ id, payload: f.payload }));
      const damaged = unknown.filter((id) => unreadable.has(id) && !downloading.has(id)).map((id) => ({ id, age: 0 }));
      return { files, pending: unknown.filter((id) => downloading.has(id)), damaged, present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { "": true } });
    this.browser = S();
    this.docs = new Map();
  }
  async with(fn) {
    useBrowser.setState(this.browser, true);
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    try {
      return await fn();
    } finally {
      this.browser = S();
      this.docs = new Map(shell.docs);
    }
  }
}

const ops = (key) =>
  [...folder.values()]
    .map((f) => JSON.parse(f.payload))
    .flatMap((f) => f.ops ?? Object.entries(f.records ?? {}).map(([k, r]) => ({ k, v: r.v })))
    .filter((op) => op.k === key);
const tombstones = (key) => new Set([...folder.values()].map((f) => JSON.parse(f.payload)).filter((f) => f.ops).flatMap((f) => f.ops).filter((op) => op.k === key && op.v === null).map((op) => op.h)).size;
const live = (key) => {
  const last = ops(key).at(-1);
  return !!last && last.v !== null;
};

async function turnOn(mac, engine) {
  await mac.with(async () => {
    engine.startSync();
    assert.ok("ok" in (await engine.turnOnSync("/sync")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

async function join(mac, engine, before = () => {}) {
  await mac.with(async () => {
    before();
    engine.startSync();
    assert.ok("ok" in (await engine.enterRecoveryPhrase("/sync", "words")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

function pauseRead(scope) {
  let reached;
  let release;
  const arrived = new Promise((resolve) => (reached = resolve));
  gate = { scope, reached, released: new Promise((resolve) => (release = resolve)) };
  return { arrived, release };
}

async function removeWhileItComesBack(remover, removerEngine, other, otherEngine, remove) {
  await remover.with(async () => {
    assert.equal(remove(), true);
    const pause = pauseRead("app");
    const cycle = removerEngine.syncNow();
    await pause.arrived;
    const browser = S();
    const docs = new Map(shell.docs);
    await other.with(async () => {
      await otherEngine.syncNow();
      await otherEngine.syncNow();
    });
    useBrowser.setState(browser, true);
    shell.docs.clear();
    for (const [k, v] of docs) shell.docs.set(k, v);
    pause.release();
    await cycle;
  });
}

async function rounds(n, ...pairs) {
  for (let i = 0; i < n; i++) for (const [mac, engine] of pairs) await mac.with(() => engine.syncNow());
}

const syncDoc = (mac) => JSON.parse(mac.docs.get("sync.json"));

test("a device that publishes itself again while the removal is still on its way back is deleted once and then left alone", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?returnA");
  const engineB = await import("./engine.ts?returnB");
  await turnOn(a, engineA);
  await join(b, engineB);
  const bId = await b.with(() => engineB.useSync.getState().devices.find((d) => d.current).id);
  await a.with(() => engineA.syncNow());
  await removeWhileItComesBack(a, engineA, b, engineB, () => engineA.removeSyncedDevice(bId));
  assert.equal(live(`dev:${bId}`), true, "B published itself again while A was between its publish and its pull");
  await rounds(4, [a, engineA], [b, engineB]);
  const written = writes;
  await rounds(10, [a, engineA], [b, engineB]);
  assert.equal(tombstones(`dev:${bId}`), 1, "A deleted B's record once");
  await a.with(() => assert.ok(engineA.useSync.getState().devices.some((d) => d.id === bId), "A lists B again"));
  assert.equal(syncDoc(a).removingDevices, undefined, "and has nothing left to remove");
  assert.equal(live(`dev:${bId}`), true);
  assert.equal(writes - written, 0, "the folder stops growing");
});

test("a profile another Mac publishes again while the removal is still on its way back is deleted once, with its sharing link, and then left alone", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?returnProfA");
  const engineC = await import("./engine.ts?returnProfC");
  const work = await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  await join(c, engineC);
  await c.with(async () => {
    const offered = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Work");
    engineC.addRemoteProfile(offered.syncId);
    await engineC.syncNow();
  });
  const syncId = await a.with(async () => {
    S().deleteProfile(work);
    await engineA.syncNow();
    await engineA.syncNow();
    return engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work").syncId;
  });
  await removeWhileItComesBack(a, engineA, c, engineC, () => engineA.removeRemoteProfile(syncId));
  assert.equal(live(`prof:${syncId}`), true, "C published the profile again while A was between its publish and its pull");
  await rounds(4, [a, engineA], [c, engineC]);
  const written = writes;
  await rounds(10, [a, engineA], [c, engineC]);
  assert.equal(tombstones(`prof:${syncId}`), 1, "A deleted the profile record once");
  assert.equal(tombstones(`share:${syncId}`), 1, "and its sharing link once");
  await a.with(() => assert.ok(engineA.useSync.getState().remoteProfiles.some((p) => p.syncId === syncId), "A offers it again"));
  assert.equal(syncDoc(a).removing, undefined, "and has nothing left to remove");
  assert.equal(live(`prof:${syncId}`), true);
  assert.equal(live(`share:${syncId}`), true);
  assert.equal(writes - written, 0, "the folder stops growing");
});

async function crashAfterTheTombstone(mac, engine, remove) {
  return mac.with(async () => {
    assert.equal(remove(), true);
    const pause = pauseRead("app");
    void engine.syncNow();
    await pause.arrived;
    return new Map(shell.docs);
  });
}

function restarted(name, docs) {
  const mac = new Mac(name);
  mac.docs = new Map(docs);
  return mac;
}

test("a device removal survives a crash after its tombstone was written, and settles after the restart without deleting again", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?crashA");
  const engineB = await import("./engine.ts?crashB");
  await turnOn(a, engineA);
  await join(b, engineB);
  const bId = await b.with(() => engineB.useSync.getState().devices.find((d) => d.current).id);
  await a.with(() => engineA.syncNow());
  const onDisk = await crashAfterTheTombstone(a, engineA, () => engineA.removeSyncedDevice(bId));
  assert.equal(tombstones(`dev:${bId}`), 1, "the tombstone reached the folder before the crash");
  const again = restarted("A again", onDisk);
  a.browser = null;
  const engineAgain = await import("./engine.ts?crashAgainA");
  await again.with(async () => {
    engineAgain.startSync();
    assert.ok(!engineAgain.useSync.getState().devices.some((d) => d.id === bId), "B is still hidden after the restart");
    await engineAgain.syncNow();
    await engineAgain.syncNow();
  });
  await rounds(4, [again, engineAgain]);
  assert.equal(tombstones(`dev:${bId}`), 1, "nothing deleted B a second time");
  assert.equal(syncDoc(again).removingDevices, undefined, "the removal settled");
  await again.with(() => assert.ok(!engineAgain.useSync.getState().devices.some((d) => d.id === bId), "and B stays gone"));
});

test("a device that came back while the Mac that removed it was down is left alone after that Mac restarts", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?downA");
  const engineB = await import("./engine.ts?downB");
  await turnOn(a, engineA);
  await join(b, engineB);
  const bId = await b.with(() => engineB.useSync.getState().devices.find((d) => d.current).id);
  await a.with(() => engineA.syncNow());
  const onDisk = await crashAfterTheTombstone(a, engineA, () => engineA.removeSyncedDevice(bId));
  await b.with(async () => {
    await engineB.syncNow();
    await engineB.syncNow();
  });
  assert.equal(live(`dev:${bId}`), true, "B published itself again");
  const again = restarted("A again", onDisk);
  const engineAgain = await import("./engine.ts?downAgainA");
  await again.with(async () => {
    engineAgain.startSync();
    await engineAgain.syncNow();
    await engineAgain.syncNow();
  });
  await rounds(4, [again, engineAgain], [b, engineB]);
  const written = writes;
  await rounds(10, [again, engineAgain], [b, engineB]);
  assert.equal(tombstones(`dev:${bId}`), 1, "nothing deleted B a second time");
  assert.equal(syncDoc(again).removingDevices, undefined);
  await again.with(() => assert.ok(engineAgain.useSync.getState().devices.some((d) => d.id === bId), "A lists B again"));
  assert.equal(writes - written, 0, "the folder stops growing");
});
