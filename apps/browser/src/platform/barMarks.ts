export type BarFieldMarks = {
  change(variant: string, eventCount: number, length: number): void;
  write(variant: string, length: number, nativeLength: number): void;
  suggestions(ms: number, textLength: number): void;
};

export const barFieldMarks: BarFieldMarks = { change() {}, write() {}, suggestions() {} };
