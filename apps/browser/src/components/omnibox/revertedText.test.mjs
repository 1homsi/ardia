import assert from "node:assert/strict";
import { test } from "node:test";
import { REVERT_WINDOW_MS, freshRevertWatch, readNativeText } from "./revertedText.ts";

const at = (n) => ({ start: n, end: n });

function typeInto(changes, start = 1000) {
  let watch = freshRevertWatch();
  const seen = [];
  for (const [i, change] of changes.entries()) {
    const [next, caret = at(next.length), now = start + i * 80] = change;
    const read = readNativeText(watch, next, caret, now);
    watch = read.watch;
    seen.push({ text: read.text, caret: read.caret });
  }
  return seen;
}

test("the field's first change reverted under the second letter is grafted back, with the caret after it", () => {
  const seen = typeInto([["e"], ["ex"], ["ea", at(2)], ["eam"]]);
  assert.deepEqual(seen.map((s) => s.text), ["e", "ex", "exa", "exam"]);
  assert.deepEqual(seen.map((s) => s.caret), [null, null, 3, 4]);
});

test("once native holds the grafted text again, changes pass through", () => {
  const seen = typeInto([["e"], ["ex"], ["ea"], ["exam"], ["examp"]]);
  assert.deepEqual(seen.map((s) => s.text), ["e", "ex", "exa", "exam", "examp"]);
  assert.deepEqual(seen.slice(3).map((s) => s.caret), [null, null]);
});

test("ordinary typing, Backspace and a word deleted at the end pass through untouched", () => {
  assert.deepEqual(typeInto([["e"], ["ex"], ["exa"], ["ex"], ["exa"], ["e"]]).map((s) => s.text), ["e", "ex", "exa", "ex", "exa", "e"]);
});

test("replacing a selection is the person's own edit, not a revert", () => {
  const seen = typeInto([["e"], ["ex"], ["ea", at(2)]].map(([t, c], i) => (i === 2 ? [t, { start: 1, end: 2 }] : [t, c])));
  assert.equal(seen[2].text, "ea");
});

test("an edit in the middle of the text is never grafted", () => {
  assert.equal(typeInto([["e"], ["ex"], ["ea", at(1)]])[2].text, "ea");
});

test("a revert is only looked for once, and only soon after the first change", () => {
  assert.equal(typeInto([["e"], ["ex"], ["ea"], ["e"], ["ex"], ["ea"]])[5].text, "ea");
  assert.equal(typeInto([["e", undefined, 0], ["ex", undefined, 50], ["ea", undefined, REVERT_WINDOW_MS + 1]])[2].text, "ea");
});

test("text that does not start from the first change is left alone", () => {
  assert.equal(typeInto([["e"], ["ex"], ["a"]])[2].text, "a");
  assert.equal(typeInto([["ab"], ["abc"], ["abc"]])[2].text, "abc");
});

test("a paste as the first change is grafted the same way", () => {
  assert.deepEqual(typeInto([["exam"], ["examp"], ["examl"]]).map((s) => s.text), ["exam", "examp", "exampl"]);
});
