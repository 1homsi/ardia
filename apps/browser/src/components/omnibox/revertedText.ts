import type { Selection } from "./inline";

export const REVERT_WINDOW_MS = 3000;

export type RevertWatch = { first: string | null; firstAt: number; heard: string; kept: string | null; spent: boolean };

export type RevertRead = { text: string; watch: RevertWatch; caret: number | null };

export const freshRevertWatch = (): RevertWatch => ({ first: null, firstAt: 0, heard: "", kept: null, spent: false });

const collapsedAtEnd = (caret: Selection, ...texts: string[]) => caret.start === caret.end && texts.some((t) => caret.end === t.length);

export function readNativeText(watch: RevertWatch, next: string, caret: Selection, now: number): RevertRead {
  if (watch.first === null) return { text: next, watch: { ...watch, first: next, firstAt: now, heard: next }, caret: null };
  const first = watch.first;
  const heard = { ...watch, heard: next };
  if (watch.kept !== null) {
    if (!next.startsWith(first) || next.startsWith(watch.kept)) return { text: next, watch: { ...heard, kept: null }, caret: null };
    const text = watch.kept + next.slice(first.length);
    return { text, watch: heard, caret: graftedCaret(caret, next, text) };
  }
  const reverted =
    !watch.spent &&
    now - watch.firstAt <= REVERT_WINDOW_MS &&
    collapsedAtEnd(caret, watch.heard, next) &&
    watch.heard.length > first.length &&
    watch.heard.startsWith(first) &&
    next.startsWith(first) &&
    !next.startsWith(watch.heard) &&
    !watch.heard.startsWith(next);
  if (!reverted) return { text: next, watch: heard, caret: null };
  const text = watch.heard + next.slice(first.length);
  return { text, watch: { ...heard, kept: watch.heard, spent: true }, caret: graftedCaret(caret, next, text) };
}

function graftedCaret(caret: Selection, next: string, text: string) {
  const at = caret.start === caret.end ? caret.end : next.length;
  return Math.min(text.length, at + text.length - next.length);
}
