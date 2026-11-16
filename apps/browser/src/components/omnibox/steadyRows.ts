import { useRef } from "react";
import { noteRowsHeldUnderPointer } from "../../state/telemetry/inlineCompletionCounts";

export type SteadyRows<T> = { key: string; items: T[] };

export function steadyRows<T>(shown: SteadyRows<T> | null, items: T[], key: string, holding: boolean): SteadyRows<T> {
  if (holding && shown && shown.key === key && shown.items.length > 0) return shown;
  return shown && shown.key === key && shown.items === items ? shown : { key, items };
}

export function useSteadyRows<T>(items: T[], key: string, holding: boolean): T[] {
  const shown = useRef<SteadyRows<T> | null>(null);
  const counted = useRef<string | null>(null);
  shown.current = steadyRows(shown.current, items, key, holding);
  if (counted.current !== key && shown.current.items.length !== items.length) {
    counted.current = key;
    noteRowsHeldUnderPointer();
  }
  return shown.current.items;
}
