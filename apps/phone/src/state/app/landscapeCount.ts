import { countUsage } from "../telemetry/telemetry";

let counted = false;

export function noteWindowShape(width: number, height: number) {
  if (counted || width <= height) return;
  counted = true;
  countUsage("landscape_shown");
}

export const forgetLandscapeCount = () => {
  counted = false;
};
