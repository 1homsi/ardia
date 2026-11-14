import { parseColor, type Rgba } from "./color";

export type GradientFillSource = { fill?: unknown; fillColors?: unknown; fillStops?: unknown; fade?: unknown; fadeStops?: unknown };

export type GradientFill = { stops: Rgba[]; places?: number[]; fade?: number[]; fadePlaces?: number[] };

const numbers = (value: unknown): number[] | undefined =>
  Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? (value as number[]) : undefined;

const placedFor = (places: number[] | undefined, count: number) => (places && places.length === count ? places : undefined);

export function gradientFill({ fill, fillColors, fillStops, fade, fadeStops }: GradientFillSource): GradientFill | null {
  const alphas = numbers(fade);
  const faded = alphas && alphas.length >= 2 ? alphas : undefined;
  const parsed = Array.isArray(fillColors) ? fillColors.map(parseColor) : [];
  const listed = parsed.length >= 2 && parsed.every((stop): stop is Rgba => !!stop) ? parsed : null;
  const solid = parseColor(fill);
  const stops = listed ?? (faded && solid ? [solid, solid] : null);
  if (!stops) return null;
  return {
    stops,
    places: listed ? placedFor(numbers(fillStops), listed.length) : undefined,
    fade: faded,
    fadePlaces: faded ? placedFor(numbers(fadeStops), faded.length) : undefined,
  };
}

export const flatColors = (stops: readonly Rgba[]) => stops.flatMap((stop) => [...stop]);
