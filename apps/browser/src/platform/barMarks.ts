export type BarFieldMarks = {
  change(variant: string, eventCount: number, length: number): void;
  write(variant: string, length: number, nativeLength: number): void;
  suggestions(ms: number, textLength: number): void;
  repair(variant: string, letters: number, at: number): void;
};

export const barFieldMarks: BarFieldMarks = { change() {}, write() {}, suggestions() {}, repair() {} };
