//
// Fixed-position color + dash convention for the multi-scenario comparison
// tab. Index 0 = baseline (desaturated slate, dotted); indices 1-3 = compare
// slots in emerald/amber/violet with distinct dash patterns. Chart.js consumes
// the dash arrays directly as `borderDash`.
//
// Why fixed-by-position, not by scenario semantics: delta sign is not always
// meaningful (higher spending isn't categorically bad). Position-stable colors
// keep the chip <-> chart-line <-> table-column mapping intuitive when advisors
// reorder plans.

export const MAX_PLANS = 4 as const;

interface SeriesEntry {
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
  readonly dash: readonly number[];
}

export const SERIES_COLORS: readonly SeriesEntry[] = [
  { hex: "#cbd5e1", rgb: [203, 213, 225], dash: [2, 3] },   // 0 baseline / slate-300 / dotted
  { hex: "#34d399", rgb: [52, 211, 153], dash: [] },         // 1 / emerald-400 / solid
  { hex: "#fbbf24", rgb: [251, 191, 36], dash: [8, 4] },     // 2 / amber-400 / long dash
  { hex: "#a78bfa", rgb: [167, 139, 250], dash: [4, 4] },    // 3 / violet-400 / short dash
] as const;

export function seriesColor(index: number): string | undefined {
  return SERIES_COLORS[index]?.hex;
}

export function seriesDash(index: number): readonly number[] | undefined {
  return SERIES_COLORS[index]?.dash;
}

export function seriesTintBg(index: number, alpha = 0.08): string | undefined {
  const entry = SERIES_COLORS[index];
  if (!entry) return undefined;
  const [r, g, b] = entry.rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
