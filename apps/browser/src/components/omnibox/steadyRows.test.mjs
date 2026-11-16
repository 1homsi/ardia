import assert from "node:assert/strict";
import { test } from "node:test";
import { steadyRows } from "./steadyRows.ts";

const page = { kind: "page", url: "https://example.com/" };
const search = { kind: "search", query: "example.com" };
const late = { kind: "search", query: "example.com email", suggested: true };

test("rows that arrive while the pointer is over the list or Go wait, so Go stays under the pointer", () => {
  const shown = steadyRows(null, [page, search], "example.com", false);
  const held = steadyRows(shown, [page, search, late], "example.com", true);
  assert.deepEqual(held.items, [page, search]);
});

test("the waiting rows show once the pointer leaves", () => {
  const shown = steadyRows(null, [page, search], "example.com", true);
  const left = steadyRows(steadyRows(shown, [page, search, late], "example.com", true), [page, search, late], "example.com", false);
  assert.deepEqual(left.items, [page, search, late]);
});

test("new text always shows its own rows, pointer or not", () => {
  const shown = steadyRows(null, [page, search], "example.co", true);
  assert.deepEqual(steadyRows(shown, [page, search, late], "example.com", true).items, [page, search, late]);
});

test("an empty list is never held, so the first rows show under a resting pointer", () => {
  const shown = steadyRows(null, [], "e", true);
  assert.deepEqual(steadyRows(shown, [page], "e", true).items, [page]);
});
