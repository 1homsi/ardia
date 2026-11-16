import assert from "node:assert/strict";
import { test } from "node:test";
const { openDownload, unpackedPath, isArchive } = await import("./openDownload.ts");
const { takeDownloadsPanelCounts } = await import("../telemetry/downloadsPanelCounts.ts");

function fakeMac(files, unpacksAfter = 2) {
  const present = new Set(files);
  const calls = [];
  let waits = 0;
  return {
    calls,
    present,
    deps: {
      exists: (path) => present.has(path),
      open: async (path) => (calls.push(["open", path]), present.has(path)),
      reveal: async (path) => (calls.push(["reveal", path]), true),
      wait: async () => {
        waits++;
        if (waits === unpacksAfter && present.unpack) present.add(present.unpack);
      },
    },
  };
}

test("archives are told apart from other downloads", () => {
  for (const name of ["a.zip", "a.ZIP", "a.tar.gz", "a.tgz", "a.tar.xz", "a.gz"]) assert.ok(isArchive(`/d/${name}`), name);
  for (const name of ["a.dmg", "a.pdf", "zip", "a.zip.pdf"]) assert.ok(!isArchive(`/d/${name}`), name);
});

test("the folder Archive Utility will make is the archive's name, or the next free numbered one", () => {
  assert.equal(unpackedPath("/d/Report.zip", () => false), "/d/Report");
  assert.equal(unpackedPath("/d/site.tar.gz", () => false), "/d/site");
  const taken = new Set(["/d/Report", "/d/Report 2"]);
  assert.equal(unpackedPath("/d/Report.zip", (p) => taken.has(p)), "/d/Report 3");
});

test("opening a downloaded zip shows it in Finder at once, then the unpacked folder once it appears (#785)", async () => {
  takeDownloadsPanelCounts();
  const mac = fakeMac(["/d/Report.zip"]);
  mac.present.unpack = "/d/Report";
  assert.equal(await openDownload("/d/Report.zip", mac.deps), true);
  assert.deepEqual(mac.calls, [["open", "/d/Report.zip"], ["reveal", "/d/Report.zip"], ["reveal", "/d/Report"]]);
  const counts = takeDownloadsPanelCounts();
  assert.equal(counts.download_archives_opened, 1);
  assert.equal(counts.download_archives_unpacked_shown, 1);
});

test("a zip whose contents don't land in a folder of its name is still shown, and the wait gives up", async () => {
  const mac = fakeMac(["/d/One.zip"]);
  assert.equal(await openDownload("/d/One.zip", mac.deps), true);
  assert.deepEqual(mac.calls, [["open", "/d/One.zip"], ["reveal", "/d/One.zip"]]);
});

test("other files only open, and a missing archive isn't revealed", async () => {
  const mac = fakeMac(["/d/a.pdf"]);
  await openDownload("/d/a.pdf", mac.deps);
  assert.equal(await openDownload("/d/gone.zip", mac.deps), false);
  assert.deepEqual(mac.calls, [["open", "/d/a.pdf"], ["open", "/d/gone.zip"]]);
});
