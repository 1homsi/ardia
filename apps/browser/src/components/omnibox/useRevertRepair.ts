import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TextInput } from "react-native";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { barFieldMarks } from "../../state/omnibox/barMarks";
import { noteDroppedLetterRestored } from "../../state/telemetry/inlineCompletionCounts";
import type { Selection } from "./inline";
import { freshRevertWatch, readNativeText } from "./revertedText";

export function useRevertRepair(
  inputRef: RefObject<TextInput | null>,
  variant: string,
  value: string | undefined,
  onChangeText: ((text: string) => void) | undefined,
  onSelection: (next: Selection) => void,
) {
  const watch = useRef(freshRevertWatch());
  const caret = useRef<Selection>({ start: 0, end: 0 });
  const pending = useRef<{ text: string; at: number } | null>(null);

  useLayoutEffect(() => {
    const grafted = pending.current;
    if (!grafted || value === undefined || !value.startsWith(grafted.text)) return;
    pending.current = null;
    caret.current = { start: grafted.at, end: grafted.at };
    inputRef.current?.setSelection(grafted.at, grafted.at);
    onSelection(caret.current);
  }, [value]);

  const changed = (next: string) => {
    if (!PLATFORM_FEATURES.textInputRevertsFirstChange) return onChangeText?.(next);
    const read = readNativeText(watch.current, next, caret.current, Date.now());
    if (read.watch.spent && !watch.current.spent) noteDroppedLetterRestored();
    watch.current = read.watch;
    if (read.caret !== null) {
      pending.current = { text: read.text, at: read.caret };
      barFieldMarks.repair(variant, next.length, read.text.length);
    }
    onChangeText?.(read.text);
  };

  const selected = (next: Selection) => {
    caret.current = next;
  };

  return { changed, selected };
}
