#!/usr/bin/env node
// A real Mac sync peer for an Android phone on adb, so a phone can sync without a reachable Mac.
//
//   node apps/phone/scripts/phone-sync-mac.mjs --app <Ardia.app> [--work DIR] [--serial SERIAL]
//                                              [--phone-folder PATH] [--every SECONDS] [--metro-port PORT]
//
// The Mac app is a Debug build of this checkout, for example:
//   scripts/agent/locked pod -- sh -c 'cd apps/browser/macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install'
//   ARDIACORE_FRAMEWORK="$(packages/ardiacore/scripts/fetch-engine.sh --nearest)" \
//     XCODE_XCCONFIG_FILE="$PWD/apps/browser/macos/AdHoc.xcconfig" scripts/agent/build-app --as phone-sync-mac
// and its JavaScript comes from a Metro for apps/browser on --metro-port (default 8081):
//   (cd apps/browser && pnpm exec react-native start --port 8099)
//
// It runs a hidden Ardia for Mac instance whose sync folder is <work>/folder, turns sync on there once and
// writes the recovery phrase to <work>/phrase.txt. It then mirrors <work>/folder and the phone's folder
// (default /sdcard/Documents/Ardia Sync) both ways over adb, file by file, newest first, following deletions,
// and prints the Mac's device list (ids and names) whenever it changes. On the phone, pick that folder in the
// system picker (Documents › Ardia Sync) and enter the phrase. Ctrl-C quits the Mac instance; run it again
// with the same --work to continue with the same Mac and folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../../../scripts/lib/instance.mjs";


function options(argv) {
  const found = { work: path.join(process.env.TMPDIR ?? "/tmp", "ardia-phone-sync-mac"), phoneFolder: "/sdcard/Documents/Ardia Sync", every: 3, metroPort: 8081 };
  for (let index = 0; index < argv.length; index += 1) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (name === "--help" || name === "-h") found.help = true;
    else if (name === "--app") (found.app = value), (index += 1);
    else if (name === "--work") (found.work = value), (index += 1);
    else if (name === "--serial") (found.serial = value), (index += 1);
    else if (name === "--phone-folder") (found.phoneFolder = value), (index += 1);
    else if (name === "--every") (found.every = Number(value)), (index += 1);
    else if (name === "--metro-port") (found.metroPort = Number(value)), (index += 1);
    else throw new Error(`unknown option ${name}`);
  }
  return found;
}

const printHelp = () => {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.filter((line) => line.startsWith("//")).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
};

const say = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

export function plan(local, remote, seenBefore) {
  const steps = [];
  for (const file of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const here = local[file];
    const there = remote[file];
    if (here && there) {
      if (here.mtime === there.mtime && here.size === there.size) continue;
      steps.push({ kind: here.mtime >= there.mtime ? "push" : "pull", file });
    } else if (here) {
      steps.push({ kind: seenBefore.has(file) ? "deleteHere" : "push", file });
    } else {
      steps.push({ kind: seenBefore.has(file) ? "deleteThere" : "pull", file });
    }
  }
  return steps.sort((a, b) => a.file.localeCompare(b.file));
}

function localFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        files[path.relative(root, full)] = { mtime: Math.floor(stat.mtimeMs / 1000), size: stat.size };
      }
    }
  };
  walk(root);
  return files;
}

function adb(serial, args, input) {
  return execFileSync("adb", [...(serial ? ["-s", serial] : []), ...args], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
}

const quoted = (text) => `'${text.replace(/'/g, `'\\''`)}'`;

function remoteFiles(serial, root) {
  const out = adb(serial, ["shell", `cd ${quoted(root)} && find . -type f -exec stat -c '%Y %s %n' {} +`]);
  const files = {};
  for (const line of out.split("\n")) {
    const match = /^(\d+) (\d+) \.\/(.+)$/.exec(line.trim());
    if (match) files[match[3]] = { mtime: Number(match[1]), size: Number(match[2]) };
  }
  return files;
}

function mirrorOnce(opts, folder, seen) {
  const steps = plan(localFiles(folder), remoteFiles(opts.serial, opts.phoneFolder), seen);
  for (const { kind, file } of steps) {
    const here = path.join(folder, file);
    const there = `${opts.phoneFolder}/${file}`;
    if (kind === "push") {
      adb(opts.serial, ["shell", `mkdir -p ${quoted(path.posix.dirname(there))}`]);
      adb(opts.serial, ["push", here, there]);
      const mtime = Math.floor(fs.statSync(here).mtimeMs / 1000);
      adb(opts.serial, ["shell", `touch -m -d @${mtime} ${quoted(there)}`]);
    } else if (kind === "pull") {
      fs.mkdirSync(path.dirname(here), { recursive: true });
      adb(opts.serial, ["pull", "-a", there, here]);
    } else if (kind === "deleteHere") {
      fs.rmSync(here, { force: true });
    } else {
      adb(opts.serial, ["shell", `rm -f ${quoted(there)}`]);
    }
    say(`${kind} ${file}`);
  }
  return new Set([...Object.keys(localFiles(folder))]);
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help || !opts.app) {
    printHelp();
    process.exit(opts.help ? 0 : 64);
  }
  const folder = path.join(opts.work, "folder");
  fs.mkdirSync(folder, { recursive: true });
  adb(opts.serial, ["shell", `mkdir -p ${quoted(opts.phoneFolder)}`]);
  const mac = await launch(path.resolve(opts.app), {
    metroPort: opts.metroPort,
    data: path.join(opts.work, "mac"),
    instance: { syncFolder: folder },
    test: { reauth: "granted" },
    ready: { timeout: 120_000, test: "return !!globalThis.acSync && Object.keys(ac.store.getState().windows).length > 0" },
  });
  say(`Mac instance pid ${mac.pid}, data ${path.join(opts.work, "mac")}, log ${mac.log}`);
  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    await mac.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  const enabled = await mac.eval("return acSync.useSync.getState().enabled");
  if (!enabled) {
    const turned = await mac.eval(`return acSync.turnOnSync(${JSON.stringify(folder)})`);
    say(`sync on: ${JSON.stringify(turned)}`);
    const phrase = (await mac.eval("return acSync.native.recoveryWords()")).join(" ");
    fs.writeFileSync(path.join(opts.work, "phrase.txt"), `${phrase}\n`, { mode: 0o600 });
    say(`recovery phrase written to ${path.join(opts.work, "phrase.txt")}`);
  } else {
    say("sync was already on for this Mac");
  }
  const seenFile = path.join(opts.work, "mirror-seen.json");
  let seen = new Set(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : []);
  let lastDevices = "";
  for (;;) {
    try {
      seen = mirrorOnce(opts, folder, seen);
      fs.writeFileSync(seenFile, JSON.stringify([...seen]));
      await mac.eval("return acSync.syncNow()").catch(() => undefined);
      const devices = await mac.eval("const u = acSync.useSync.getState(); return { mac: acSync.doc().deviceId, devices: u.devices.map((d) => ({ id: d.id, name: d.name })) }");
      const shown = JSON.stringify(devices);
      if (shown !== lastDevices) {
        lastDevices = shown;
        say(`devices the Mac sees: ${shown}`);
      }
    } catch (error) {
      say(`mirror pass failed: ${error.message.split("\n")[0]}`);
    }
    await new Promise((done) => setTimeout(done, opts.every * 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exit(1);
  });
}
