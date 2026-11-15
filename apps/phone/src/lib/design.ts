export type Design = "original" | "redesigned";

export const DESIGNS: readonly Design[] = ["original", "redesigned"];

export const designFor = (os: string): Design => (os === "ios" ? "redesigned" : "original");
