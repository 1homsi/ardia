import fs from "node:fs";
import path from "node:path";

const SCRIPT = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
let args = process.argv.slice(2);
if (args[0] === "-s") args = args.slice(2);
const [kind, command] = args;
if (process.env.FAKE_ADB_LOG) fs.appendFileSync(process.env.FAKE_ADB_LOG, kind + " " + command + "\\n");
if (kind === "exec-in") {
  const first = command.split(/\\s*(?:&&|\\|\\||;)\\s*/)[0];
  let input = fs.readFileSync(0);
  if (process.env.FAKE_ADB_TRUNCATE === "1") input = input.subarray(0, Math.floor(input.length / 2));
  spawnSync("sh", ["-c", first], { input, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(0);
}
const result = spawnSync("sh", ["-c", command], { stdio: "inherit" });
process.exit(result.status ?? 1);
`;

export function writeFakeAdb(dir: string): string {
  const file = path.join(dir, "fake-adb");
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  return file;
}
