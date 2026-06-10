// Shared axis helpers for the Retirement Comparison charts.

/** Number mono for chart labels (B612 Mono is not yet vendored — the report
 *  subsystem uses JetBrains Mono; weights 400/500/600 only). */
export const MONO = "JetBrains Mono";

/** A "nice" axis ceiling ≥ max plus evenly spaced ticks from 0. Keeps gridline
 *  labels on round numbers ($10M, $20M…) instead of raw data maxima. */
export function niceAxis(max: number, targetTicks = 4): { axisMax: number; ticks: number[] } {
  if (max <= 0) return { axisMax: 1, ticks: [0, 1] };
  const rawStep = max / targetTicks;
  const exp = Math.floor(Math.log10(rawStep));
  const f = rawStep / 10 ** exp;
  const niceF = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  const step = niceF * 10 ** exp;
  const axisMax = Math.ceil(max / step) * step;
  const count = Math.round(axisMax / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => i * step);
  return { axisMax, ticks };
}

/** Compact $ for axis ticks / annotations: $34M, $1.5M, $750K, $0. Whole
 *  millions drop the decimal; fractional millions keep one place. */
export function fmtAxisUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (a >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}
