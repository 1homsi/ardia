let shown = 0;
let restored = 0;
let held = 0;

export const noteInlineCompletionShown = () => void (shown += 1);

export const noteDroppedLetterRestored = () => void (restored += 1);

export const noteRowsHeldUnderPointer = () => void (held += 1);

export function takeInlineCompletionCounts() {
  const taken = { command_bar_inline_completions: shown, command_bar_letters_restored: restored, command_bar_rows_held: held };
  shown = 0;
  restored = 0;
  held = 0;
  return taken;
}
