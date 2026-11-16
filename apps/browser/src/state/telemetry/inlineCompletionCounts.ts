import { takeKeyHoldCounts } from "../../platform/keyHold";

let shown = 0;
let restored = 0;
let held = 0;

export const noteInlineCompletionShown = () => void (shown += 1);

export const noteDroppedLetterRestored = () => void (restored += 1);

export const noteRowsHeldUnderPointer = () => void (held += 1);

export function takeInlineCompletionCounts() {
  const hold = takeKeyHoldCounts();
  const drops = Object.fromEntries(Object.entries(hold.drops).map(([reason, count]) => [`command_bar_key_hold_drops_${reason}`, count]));
  const taken = { command_bar_inline_completions: shown, command_bar_letters_restored: restored, command_bar_rows_held: held, command_bar_key_holds: hold.holds, command_bar_keys_replayed: hold.replayed, ...drops };
  shown = 0;
  restored = 0;
  held = 0;
  return taken;
}
