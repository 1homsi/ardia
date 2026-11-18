import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { analyze, compare, readBaseline, reachSinks, scopeFiles, scoreboard, writeBaseline } from "../scripts/consentReach.mjs";
import { ROOT, isTelemetryBuffer, unstampedEmits } from "../scripts/consentStatic.mjs";

function virtualProgram(sources) {
  const options = { noLib: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
  const texts = new Map(Object.entries(sources).map(([rel, text]) => [join(ROOT, rel), text]));
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, version) => (texts.has(name) ? ts.createSourceFile(name, texts.get(name), version, true) : undefined);
  host.fileExists = (name) => texts.has(name);
  host.readFile = (name) => texts.get(name);
  return ts.createProgram([...texts.keys()], options, host);
}

if (process.argv.includes("--write")) {
  writeBaseline(analyze());
} else {
  test("consent gaps the per-file tripwire can't see stay at the baseline", (t) => {
    const result = analyze();
    t.diagnostic(`reachable functions ${result.reached}, ${scoreboard(result.found)}`);
    const problems = compare(readBaseline(), result.found);
    assert.equal(
      problems.length,
      0,
      `Consent reach check. New entries fail; fixed ones must lower apps/browser/src/consent-reach-baseline.json (node apps/browser/scripts/consentReach.mjs --write):\n${problems.join("\n")}`,
    );
  });

  test("helpers reached from a continuation count, activity starts and forwarded tokens don't", () => {
    const program = virtualProgram({
      "apps/browser/src/state/telemetry/usage.ts": [
        "export type ConsentToken = string & { readonly period: 1 };",
        "export const consentToken = (): ConsentToken | null => null;",
        "export function noteThing(consent?: ConsentToken | null) {}",
        "export function noteOther(options: { times: number }) {}",
        "export function capture(event: string, props: object, consent: ConsentToken | null) {}",
      ].join("\n"),
      "apps/browser/src/state/x.ts": [
        'import { capture, consentToken, noteOther, noteThing, type ConsentToken } from "./telemetry/usage";',
        "declare const p: { then(cb: () => void): void };",
        "declare function onAppEvent(cb: () => void): void;",
        "function helperNoter() { noteThing(); }",
        'function helperToken() { capture("e", {}, consentToken()); }',
        "function helperStart() { const token = consentToken(); begin(token); }",
        "function begin(token: ConsentToken | null) { noteThing(token); noteOther({ times: 1, token } as never); }",
        'function helperLog() { console.warn("x"); }',
        "function onNative() { noteThing(); }",
        "p.then(() => { helperNoter(); helperToken(); helperStart(); helperLog(); });",
        "onAppEvent(() => onNative());",
      ].join("\n"),
    });
    const { sinks } = reachSinks(program, scopeFiles(program), new Set(["onAppEvent"]));
    assert.deepEqual(sinks.map((s) => `${s.kind}:${s.line}`), ["noter:4", "consentToken:5", "console:8"]);
  });

  test("native emits count unless the payload is stamped, on the line or before it", () => {
    const objc = [
      '[ArdiaEvents emit:@"a.plain" data:@{@"x" : @1}];',
      '[ArdiaEvents emit:@"a.stamped" data:[stamp onto:@{}]];',
      'NSDictionary *payload = [[ArdiaConsentStamp begin] onto:@{@"x" : @1}];',
      'dispatch_async(dispatch_get_main_queue(), ^{ [ArdiaEvents emit:@"a.stampedBefore" data:payload]; });',
      'NSDictionary *other = @{};',
      '[ArdiaEvents emit:@"a.unstampedVariable" data:other];',
      '[ArdiaEvents emit:@"a.multiLine"\n  data:@{\n    @"x" : @"y"\n  }];',
    ].join("\n");
    assert.deepEqual(unstampedEmits("x.mm", objc), ["x.mm | a.plain", "x.mm | a.unstampedVariable", "x.mm | a.multiLine"]);
    const swift = 'ArdiaEvents.emit("s.plain", data: event)\nlet stamped = stamp.onto(event)\nArdiaEvents.emit("s.stamped", data: stamped)';
    assert.deepEqual(unstampedEmits("x.swift", swift), ["x.swift | s.plain"]);
  });

  test("a telemetry buffer is a queue or a retry that also emits telemetry", () => {
    const buffer = (text) => isTelemetryBuffer(ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true));
    assert.equal(buffer("const pendingSaves = [];\nexport const save = () => noteSave();"), true);
    assert.equal(buffer("export async function load() { for (let retries = 0; retries < 3; retries++) await go(); console.warn('x'); }"), true);
    assert.equal(buffer("const pendingSaves = [];\nexport const save = () => go();"), false);
    assert.equal(buffer("function f() { const pending = []; noteSave(); }"), false);
  });
}
