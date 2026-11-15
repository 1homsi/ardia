import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { passwordsAdapter } = await import("./adapters.ts");

useBrowser.getState().hydrate({ profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, profileOrder: ["default"] });

const login = (host, username, sealed, created) => ({ origin: `https://${host}.example`, username, sealed, created });
const keyOf = (host, username) => `pws:https://${host}.example\n${username}`;
const valueOf = (host, username, sealed) => ({ o: `https://${host}.example`, u: username, s: sealed });

const ADA = keyOf("a", "ada");
const BO = keyOf("b", "bo");
const CY = keyOf("c", "cy");
const DEE = keyOf("d", "dee");

test("with only sealed logins, as the Mac always sends, the adapter offers, ignores and writes what it did before passwordless logins", async () => {
  const saved = [];
  const removes = () => stub.engineCalls.filter((call) => call.domain === "passwords" && call.verb === "remove").length;
  const removedBefore = removes();
  let list = [login("a", "ada", "sealed-ada", 1), login("b", "bo", "sealed-bo", 2), login("c", "cy", "sealed-cy", 3)];
  const read = async () => list.filter((l) => l.username !== "bo" || removes() === removedBefore);
  const save = async (profile, origin, username, sealed, replacing) => {
    saved.push([profile, origin, username, sealed, replacing]);
    list = [...list.filter((l) => l.origin !== origin || l.username !== username), { origin, username, sealed, created: 9 }];
    return true;
  };
  const adapter = passwordsAdapter("default", { read, save })(true);

  const extracted = await adapter.extract();
  assert.deepEqual([...extracted.values], [
    [ADA, valueOf("a", "ada", "sealed-ada")],
    [BO, valueOf("b", "bo", "sealed-bo")],
    [CY, valueOf("c", "cy", "sealed-cy")],
  ]);
  assert.deepEqual([ADA, BO, CY, DEE].map((key) => extracted.ignore?.(key) ?? false), [false, false, false, false], "nothing is ignored");

  const visible = new Map([[ADA, valueOf("a", "ada", "sealed-ada-new")], [DEE, valueOf("d", "dee", "sealed-dee")]]);
  const base = (key) => ({ [ADA]: valueOf("a", "ada", "sealed-ada"), [BO]: valueOf("b", "bo", "sealed-bo") })[key];
  await adapter.apply(visible, new Set([ADA, BO, DEE]), base, { held: () => false, landed: () => {} });
  assert.deepEqual(saved, [
    ["", "https://a.example", "ada", "sealed-ada-new", true],
    ["", "https://d.example", "dee", "sealed-dee", false],
  ], "a changed password replaces, a new one is added");
  assert.equal(removes() - removedBefore, 1, "a login deleted elsewhere is deleted here");
});
