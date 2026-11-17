import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("long press loops and unpainted windows say how long ago they began, so JS can drop ones that began before a sharing change", () => {
  assert.match(read("../ios/ArdiaFocusState.mm"), /@"seconds" : @\(seconds\)/);
  assert.match(read("../ios/ArdiaPaintProbe.mm"), /@"seconds" : @\(/);
  assert.match(read("../ios/ArdiaPointerTrace.h"), /bool EndLoop\(double now, std::string \*longName, double \*seconds = nullptr\)/);
  assert.match(read("../ios/ArdiaPointerTrace.h"), /bool TakeLongLoop\(unsigned long generation, double now, std::string \*name, double \*seconds = nullptr\)/);
});
