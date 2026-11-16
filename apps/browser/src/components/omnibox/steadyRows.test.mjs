import assert from "node:assert/strict";
import { test } from "node:test";
import { steadyRows } from "./steadyRows.ts";

const page = { kind: "page", url: "https://example.com/" };
const search = { kind: "search", query: "example.com" };
const late = { kind: "search", query: "example.com email", suggested: true };
const list = (items, completion = "") => ({ items, completion });

test("rows that arrive while the pointer is over the list or Go wait, so Go stays under the pointer", () => {
  const shown = steadyRows(null, list([page, search]), "example.com", false);
  assert.deepEqual(steadyRows(shown, list([page, search, late]), "example.com", true).value.items, [page, search]);
});

test("the completion waits with its rows, so the field and Go say the same thing", () => {
  const shown = steadyRows(null, list([search]), "exa", false);
  const held = steadyRows(shown, list([page, search], "mple.com"), "exa", true);
  assert.deepEqual(held.value, list([search]));
});

test("the waiting rows show once the pointer leaves or the keyboard moves the selection", () => {
  const shown = steadyRows(null, list([page, search]), "example.com", true);
  const held = steadyRows(shown, list([page, search, late]), "example.com", true);
  assert.deepEqual(steadyRows(held, list([page, search, late]), "example.com", false).value.items, [page, search, late]);
});

test("a row removed by hand goes at once, pointer or not", () => {
  const shown = steadyRows(null, list([page, search, late]), "example.com", false);
  assert.deepEqual(steadyRows(shown, list([page, search]), "example.com", true).value.items, [page, search]);
});

test("new text always shows its own rows, pointer or not", () => {
  const shown = steadyRows(null, list([page, search]), "example.co", true);
  assert.deepEqual(steadyRows(shown, list([page, search, late]), "example.com", true).value.items, [page, search, late]);
});

test("an empty list is never held, so the first rows show under a resting pointer", () => {
  const shown = steadyRows(null, list([]), "e", true);
  assert.deepEqual(steadyRows(shown, list([page]), "e", true).value.items, [page]);
});
