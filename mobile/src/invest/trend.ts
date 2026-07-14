// mobile/src/invest/trend.ts
//
// Pure helpers for the Investments screen's trend badges.

import type { TrendPoint } from "@contracts";

/** Fractional change from the first to the last point in a trend series.
 *  Null when there's nothing to compare (fewer than 2 points, or a first
 *  value of 0 that would make the ratio meaningless). */
export function pctChange(series: TrendPoint[]): number | null {
  if (series.length < 2) return null;
  const first = series[0].netWorth;
  const last = series[series.length - 1].netWorth;
  if (first === 0) return null;
  return (last - first) / Math.abs(first);
}

/** Signed percent label for a fractional change, e.g. `0.032 → "+3.2%"`,
 *  `-0.014 → "−1.4%"` (a proper minus sign, not a hyphen). */
export function formatPct(pct: number): string {
  const magnitude = `${Math.abs(pct * 100).toFixed(1)}%`;
  return pct < 0 ? `−${magnitude}` : `+${magnitude}`;
}
