import { useRef } from "react";
import { noteRowsHeldUnderPointer } from "../../state/telemetry/inlineCompletionCounts";

export type SteadyList<V> = { key: string; value: V };

export function steadyRows<V extends { items: unknown[] }>(shown: SteadyList<V> | null, value: V, key: string, holding: boolean): SteadyList<V> {
  const growing = !!shown && value.items.length > shown.value.items.length;
  if (holding && growing && shown!.key === key && shown!.value.items.length > 0) return shown!;
  return { key, value };
}

export function useSteadyRows<V extends { items: unknown[] }>(value: V, key: string, pointerOver: boolean, selected: number): V {
  const shown = useRef<SteadyList<V> | null>(null);
  const lastSelected = useRef(selected);
  const counted = useRef<string | null>(null);
  const keyboard = selected !== lastSelected.current;
  lastSelected.current = selected;
  shown.current = steadyRows(shown.current, value, key, pointerOver && !keyboard);
  if (shown.current.value !== value && counted.current !== key) {
    counted.current = key;
    noteRowsHeldUnderPointer();
  }
  return shown.current.value;
}
