import assert from "node:assert/strict";
import test from "node:test";
import { withAlpha } from "./color.ts";
import { inlineOffer } from "./inlineOffer.ts";

test("the field is offered the typed text with the omnibox's completion after it, keeping what was typed", () => {
  assert.deepEqual(inlineOffer("goo", "gle.com", "goo"), { query: "goo", completion: "google.com" });
  assert.deepEqual(inlineOffer("Goo", "gle.com", "Goo"), { query: "Goo", completion: "Google.com" });
});

test("no offer without a completion, for empty text, or for completions of text the field no longer holds", () => {
  assert.equal(inlineOffer("goo", "", "goo"), null);
  assert.equal(inlineOffer("", "x", ""), null);
  assert.equal(inlineOffer("goo", "gle.com", "go"), null);
});

test("the completion highlight is the accent at 30% alpha", () => {
  assert.equal(withAlpha("#007AFF", 0.3), "rgba(0, 122, 255, 0.3)");
  assert.equal(withAlpha("#0A84FF", 0.3), "rgba(10, 132, 255, 0.3)");
});
