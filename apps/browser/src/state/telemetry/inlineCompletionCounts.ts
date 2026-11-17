let shown = 0;
let sitesShown = 0;

export const noteInlineCompletionShown = () => void (shown += 1);

export const noteSiteSuggestionShown = () => void (sitesShown += 1);

export function takeInlineCompletionCounts() {
  const taken = { command_bar_inline_completions: shown, command_bar_site_suggestions: sitesShown };
  shown = 0;
  sitesShown = 0;
  return taken;
}
