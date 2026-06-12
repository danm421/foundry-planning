export const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Axis range snapped to whole percentages: 4pp below the lowest value (never
// below 0), 2pp above the highest. Returns a sane default when there's no data.
export function axisBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0.1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return {
    min: Math.max(0, round2(Math.floor(lo * 100) / 100 - 0.04)),
    max: round2(Math.ceil(hi * 100) / 100 + 0.02),
  };
}
