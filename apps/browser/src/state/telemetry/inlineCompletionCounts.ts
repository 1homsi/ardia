let shown = 0;
let shownSearchFirst = 0;
let sitesShown = 0;
let restored = 0;

export const noteInlineCompletionShown = (searchFirst = false) => void ((shown += 1), searchFirst && (shownSearchFirst += 1));

export const noteSiteSuggestionShown = () => void (sitesShown += 1);

export const noteDroppedLetterRestored = () => void (restored += 1);

export function takeInlineCompletionCounts() {
  const taken = { command_bar_inline_completions: shown, command_bar_inline_completions_search_first: shownSearchFirst, command_bar_site_suggestions: sitesShown, command_bar_letters_restored: restored };
  shown = 0;
  shownSearchFirst = 0;
  sitesShown = 0;
  restored = 0;
  return taken;
}
