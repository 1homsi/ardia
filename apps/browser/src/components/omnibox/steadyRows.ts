import { useReducer, useRef } from "react";
import { noteRowsHeldUnderPointer } from "../../state/telemetry/inlineCompletionCounts";

export type SteadyList<V> = { key: string; value: V };

const sameRows = <T,>(a: T[], b: T[], rowKey: (row: T) => string) => a.length === b.length && a.every((row, i) => rowKey(row) === rowKey(b[i]!));

export function steadyRows<T, V extends { items: T[] }>(shown: SteadyList<V> | null, value: V, key: string, holding: boolean, rowKey: (row: T) => string): SteadyList<V> {
  if (holding && shown && shown.key === key && shown.value.items.length > 0 && !sameRows(shown.value.items, value.items, rowKey)) return shown;
  return { key, value };
}

export function useSteadyRows<T, V extends { items: T[] }>(value: V, key: string, pointerOver: boolean, rowKey: (row: T) => string) {
  const shown = useRef<SteadyList<V> | null>(null);
  const counted = useRef<string | null>(null);
  const freed = useRef<string | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  if (!pointerOver) freed.current = null;
  shown.current = steadyRows(shown.current, value, key, pointerOver && freed.current !== key, rowKey);
  const held = shown.current.value !== value;
  if (held && counted.current !== key) {
    counted.current = key;
    noteRowsHeldUnderPointer();
  }
  const release = () => {
    freed.current = key;
    if (!held) return;
    shown.current = null;
    redraw();
  };
  return { value: shown.current.value, held, release };
}
