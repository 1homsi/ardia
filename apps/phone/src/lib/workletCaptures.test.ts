import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPENERS = [
  ".onBegin(",
  ".onStart(",
  ".onUpdate(",
  ".onChange(",
  ".onEnd(",
  ".onFinalize(",
  ".onTouchesDown(",
  ".onTouchesMove(",
  ".onTouchesUp(",
  ".onTouchesCancelled(",
  "useAnimatedStyle(",
  "useAnimatedReaction(",
  "useDerivedValue(",
];
const JS_ONLY_MODULES = /\b(Keyboard|Platform|AccessibilityInfo|Linking|BackHandler|Alert|Share|Vibration|Dimensions|Appearance)\./;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "dev" ? [] : files(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(" || text[i] === "{") depth++;
    else if (text[i] === ")" || text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

function workletRegions(source: string): string[] {
  const regions: string[] = [];
  for (const opener of OPENERS) {
    let at = source.indexOf(opener);
    while (at >= 0) {
      regions.push(balanced(source, at + opener.length - 1));
      at = source.indexOf(opener, at + 1);
    }
  }
  let marker = source.indexOf('"worklet"');
  while (marker >= 0) {
    const open = source.lastIndexOf("{", marker);
    if (open >= 0) regions.push(balanced(source, open));
    marker = source.indexOf('"worklet"', marker + 1);
  }
  return regions;
}

function localImports(file: string, source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
    const base = resolve(dirname(file), match[2]!);
    const target = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(existsSync);
    if (!target) continue;
    for (const part of match[1]!.split(",")) {
      const name = part.replace(/^\s*type\s+/, "").split(" as ").pop()!.trim();
      if (name) map.set(name, target);
    }
  }
  return map;
}

function isWorklet(file: string, name: string): boolean | null {
  const source = readFileSync(file, "utf8");
  const definition = new RegExp(`(?:function ${name}\\b[^{]*\\{|const ${name}\\s*=\\s*(?:\\([^)]*\\)|\\w+)[^=]*=>\\s*\\{)`).exec(source);
  if (!definition) {
    if (new RegExp(`const ${name}\\s*=\\s*(?:<[^>]*>)?\\(`).test(source)) return false;
    const reexport = new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from "(\\.[^"]+)"`).exec(source);
    if (!reexport) return null;
    const base = resolve(dirname(file), reexport[1]!);
    const target = [`${base}.ts`, `${base}.tsx`].find(existsSync);
    return target ? isWorklet(target, name) : null;
  }
  return source.slice(definition.index + definition[0].length, definition.index + definition[0].length + 60).includes('"worklet"');
}

test("worklets call only worklets and never touch React Native's JS-only modules, which crash a release build on the UI thread", () => {
  const problems: string[] = [];
  for (const file of files(SRC)) {
    const source = readFileSync(file, "utf8");
    const imports = localImports(file, source);
    for (const region of workletRegions(source)) {
      const jsOnly = JS_ONLY_MODULES.exec(region);
      if (jsOnly) problems.push(`${file.slice(SRC.length + 1)}: a worklet reads ${jsOnly[0]}`);
      for (const call of region.matchAll(/(?<![.\w])(\w+)\(/g)) {
        const name = call[1]!;
        const from = imports.get(name);
        if (!from || !/\/(lib|state)\//.test(from)) continue;
        if (isWorklet(from, name) === false) problems.push(`${file.slice(SRC.length + 1)}: a worklet calls ${name}, which isn't a worklet`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});
