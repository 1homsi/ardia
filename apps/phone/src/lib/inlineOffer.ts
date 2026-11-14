export type InlineOffer = { query: string; completion: string };

export function inlineOffer(typed: string, completion: string, suggestedFor: string): InlineOffer | null {
  if (!typed || !completion || suggestedFor !== typed) return null;
  return { query: typed, completion: typed + completion };
}
