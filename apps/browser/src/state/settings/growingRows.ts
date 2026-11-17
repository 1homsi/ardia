import { useState } from "react";
import { create } from "zustand";

export const ROW_PAGE = 100;
const NEAR_END = 600;

const useScrollEnds = create<{ reached: number }>()(() => ({ reached: 0 }));
let bumpedAt = -1;

export function noteSettingsScroll(offset: number, viewport: number, content: number) {
  if (offset + viewport < content - NEAR_END || content === bumpedAt) return;
  bumpedAt = content;
  useScrollEnds.setState((s) => ({ reached: s.reached + 1 }));
}

export function useGrowingRows(total: number, resetKey: string): number {
  const reached = useScrollEnds((s) => s.reached);
  const [start, setStart] = useState({ key: resetKey, at: reached });
  if (start.key !== resetKey) setStart({ key: resetKey, at: reached });
  const pages = 1 + (start.key === resetKey ? reached - start.at : 0);
  return Math.min(total, pages * ROW_PAGE);
}
