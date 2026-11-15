import assert from "node:assert/strict";
import { test } from "node:test";
import { barAskedWhileFocused, barBlurred, barFocused, noteFieldCommand } from "./fieldCommands.ts";

const settings = { newTabOpens: "page", minimalismMode: false, newTabUrl: "" };
const state = (panelOpen = false, more = {}) => ({ windowUi: { w: { panel: { open: panelOpen } } }, settings: { ...settings, ...more } });

test("readiness reaches native only after the command, never from a focus that came before it", () => {
  assert.equal(barFocused("w", "hero", 0), null, "a focus with no command waiting says nothing");
  assert.equal(noteFieldCommand(state(), "w", "newTab", false, 10), null, "the command alone says nothing");
  assert.equal(barFocused("w", "hero", 20), "ready", "the new bar's focus says the field is ready");
  assert.equal(barAskedWhileFocused("w", 30), null, "once per command");
  barBlurred("w", "hero");
});

test("a bar asked for focus again while it has it is ready at once", () => {
  noteFieldCommand(state(), "w", "focusCommandBar", false, 0);
  assert.equal(barAskedWhileFocused("w", 5), "ready");
});

test("a second Ctrl+L counts only when a panel bar really has focus", () => {
  assert.equal(noteFieldCommand(state(true), "w", "focusCommandBar", true, 0), null, "the panel is open but its bar has not taken focus yet");
  assert.equal(barFocused("w", "panel", 10), "ready");
  assert.equal(noteFieldCommand(state(true), "w", "focusCommandBar", true, 20), "ready", "Ctrl+L again over the focused panel is ready at once");
  barBlurred("w", "panel");
  assert.equal(noteFieldCommand(state(true), "w", "focusCommandBar", true, 30), null, "after the panel bar lost focus it waits again");
  barFocused("w", "hero", 5000);
});

test("a command that waits too long, or another command, readies nothing", () => {
  noteFieldCommand(state(), "w", "newTab", false, 0);
  assert.equal(barFocused("w", "hero", 4000), null, "a focus three seconds later belongs to something else");
  barBlurred("w", "hero");
  assert.equal(noteFieldCommand(state(), "w", "reload", true, 0), null);
  assert.equal(barFocused("w", "hero", 10), null);
  barBlurred("w", "hero");
});

test("a custom New Tab address opens no field, so the hold is cancelled", () => {
  assert.equal(noteFieldCommand(state(false, { newTabUrl: "https://example.com/" }), "w", "newTab", false, 0), "cancel");
  assert.equal(barFocused("w", "hero", 10), null);
  barBlurred("w", "hero");
});
