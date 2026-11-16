export const EAGER_SECTION_ROWS = 24;
export const NEAR_OVERSCAN = 10;
export const FAR_OVERSCAN = 0;
export const SLOW_SHEET_MS = 400;

export function eagerSections(sizes: readonly number[], rows: number = EAGER_SECTION_ROWS): boolean[] {
  let before = 0;
  return sizes.map((size) => {
    const eager = before < rows;
    before += size;
    return eager;
  });
}

export const sectionOverscan = (near: boolean) => (near ? NEAR_OVERSCAN : FAR_OVERSCAN);

export const sheetWasSlow = (requestedAt: number | null, drawnAt: number) => requestedAt !== null && drawnAt - requestedAt > SLOW_SHEET_MS;
