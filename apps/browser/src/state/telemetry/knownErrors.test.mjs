import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { KNOWN_ERROR_CODES, KNOWN_ERROR_MESSAGES, knownErrorCode, knownErrorMessage } from "./knownErrors.ts";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const packages = readdirSync(join(ROOT, "packages")).filter((name) => statSync(join(ROOT, "packages", name)).isDirectory());
const SCRIPT_TREES = ["apps/browser/src", "apps/linux/src", ...packages.map((name) => `packages/${name}/src`)];
const CODE_TREES = ["engine", "apps/browser/windows", ...SCRIPT_TREES, ...packages.map((name) => `packages/${name}/ios`)];
const SOURCE = /\.(?:tsx?|m?js|cjs|cc|cpp|h|hpp|mm|m|swift|patch|py)$/;
const SCRIPT = /\.(?:tsx?|m?js|cjs)$/;
const SKIPPED_FOLDERS = new Set(["node_modules", "tests", "test", "test-native", "fixtures", "__tests__", "Pods", "build"]);
const TEST_FILE = /\.(?:test|spec)\.[^.]+$|(?:^|_)test\.py$|_(?:unittest|browsertest)\.(?:cc|mm)$/;

function sources(tree, pattern) {
  const start = join(ROOT, tree);
  if (!existsSync(start)) return [];
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(path);
      } else if (entry.isFile() && pattern.test(entry.name) && !TEST_FILE.test(entry.name)) found.push(path);
    }
  };
  walk(start);
  return found;
}

const ERR_LITERAL = /"(ERR_[A-Z0-9_]+)"/g;
const ARDIA_ERROR = /new ArdiaError\("([^"\\]+)", "([^"\\]*)"\)/g;
const CODED_ERROR = /Object\.assign\(new Error\("([^"\\]*)"\), \{ code: "(ERR_[A-Z0-9_]+)" \}\)/g;

const definedCodes = new Set();
const definedMessages = new Map();
for (const tree of CODE_TREES) for (const file of sources(tree, SOURCE)) for (const [, code] of readFileSync(file, "utf8").matchAll(ERR_LITERAL)) definedCodes.add(code);
for (const tree of SCRIPT_TREES)
  for (const file of sources(tree, SCRIPT)) {
    const text = readFileSync(file, "utf8");
    const where = relative(ROOT, file);
    for (const [, code, message] of text.matchAll(ARDIA_ERROR)) {
      definedCodes.add(code);
      definedMessages.set(`${code}\n${message}`, where);
    }
    for (const [, message, code] of text.matchAll(CODED_ERROR)) definedMessages.set(`${code}\n${message}`, where);
  }

const difference = (wanted, have) => [...wanted].filter((item) => !have.has(item)).sort();

test("the known error codes are exactly the ones Ardia's sources define", () => {
  const known = new Set(KNOWN_ERROR_CODES);
  assert.ok(definedCodes.size > 100, `only ${definedCodes.size} codes found; the scan is looking in the wrong place`);
  assert.deepEqual({ missing: difference(definedCodes, known), extra: difference(known, definedCodes) }, { missing: [], extra: [] });
});

test("the known error messages are exactly the literal ones Ardia's sources define with their codes", () => {
  const known = new Set(KNOWN_ERROR_MESSAGES.map(([code, message]) => `${code}\n${message}`));
  const missing = difference(definedMessages.keys(), known).map((pair) => `${pair.replace("\n", ": ")} (${definedMessages.get(pair)})`);
  assert.deepEqual({ missing, extra: difference(known, new Set(definedMessages.keys())).map((pair) => pair.replace("\n", ": ")) }, { missing: [], extra: [] });
});

test("only a known message or the native call template comes back, and only a known code", () => {
  assert.equal(knownErrorMessage(new Error("the reply isn't JSON")), "the reply isn't JSON");
  assert.equal(knownErrorMessage(new Error("Calling the 'query' function has failed\n    at somewhere")), "Calling the 'query' function has failed");
  assert.equal(knownErrorMessage(new Error("the reply isn't JSON: qwertySecretToken")), "");
  assert.equal(knownErrorMessage(new Error("Calling the 'a b' function has failed")), "");
  assert.equal(knownErrorMessage("the reply isn't JSON"), "");
  assert.equal(knownErrorMessage({ message: 42 }), "");
  assert.equal(knownErrorCode(Object.assign(new Error("x"), { code: "ERR_ENGINE" })), "ERR_ENGINE");
  assert.equal(knownErrorCode(Object.assign(new Error("x"), { code: "cancelled" })), "cancelled");
  assert.equal(knownErrorCode(Object.assign(new Error("x"), { code: "ERR_MADE_UP_BY_A_PAGE" })), null);
  assert.equal(knownErrorCode(Object.assign(new Error("x"), { code: 7 })), null);
});
