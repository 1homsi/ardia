import assert from "node:assert/strict";
import { test } from "node:test";
import { armTypeAhead, barBlurred, barFocused, takeTypeAhead } from "./typeAhead.ts";

function field(text = "", start = text.length, end = start) {
  const bar = { text, start, end, read: () => ({ text: bar.text, start: bar.start, end: bar.end }), type: (next) => void ((bar.text = next), (bar.start = bar.end = next.length)) };
  return bar;
}

test("letters typed into the old bar between Ctrl+T and the new bar's focus move to the new bar", () => {
  const first = field("");
  barFocused(first);
  armTypeAhead("w", 1000);
  first.type("exa");
  barBlurred(first);
  const fresh = field("");
  assert.equal(takeTypeAhead("w", fresh, 1400), "exa");
  assert.equal(first.text, "", "the old bar is back to what it held before the command");
});

test("a command bar opened over a selected address replaces the selection with the moved letters", () => {
  const hero = field("");
  barFocused(hero);
  armTypeAhead("w", 0);
  hero.type("ab");
  const panel = field("https://example.com/", 0, 20);
  assert.equal(takeTypeAhead("w", panel, 100), "ab");
});

test("nothing moves when nothing was typed, when the same bar takes focus again, or too late", () => {
  const hero = field("kept");
  barFocused(hero);
  armTypeAhead("w", 0);
  assert.equal(takeTypeAhead("w", field(""), 50), null, "no letters since the command");
  barFocused(hero);
  armTypeAhead("w", 0);
  hero.type("kept1");
  assert.equal(takeTypeAhead("w", hero, 50), null, "the bar that had the letters keeps them");
  assert.equal(hero.text, "kept1");
  armTypeAhead("w", 0);
  hero.type("kept12");
  assert.equal(takeTypeAhead("w", field(""), 5000), null, "a bar that focuses seconds later takes nothing");
  assert.equal(hero.text, "kept12");
});

test("a command in another window, or with no bar focused, arms nothing", () => {
  const hero = field("");
  barFocused(hero);
  armTypeAhead("w", 0);
  hero.type("x");
  assert.equal(takeTypeAhead("other", field(""), 10), null);
  barBlurred(hero);
  armTypeAhead("w", 0);
  hero.type("xy");
  assert.equal(takeTypeAhead("w", field(""), 10), null);
});
