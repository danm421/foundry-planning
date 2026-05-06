// src/lib/reports/widgets/tax-bracket-chart.shared.ts
//
// Shared bucket math + bracket palette for the taxBracketChart widget.
// Both the screen render (Chart.js) and the PDF render (native SVG)
// consume `BRACKETS_2026_SINGLE` and `splitIncomeIntoBrackets`. Keep this
// file framework-light: no React, no chart.js, no @react-pdf/renderer.
//
// Per the Phase-5d plan, 2026 single-filer brackets are hard-coded
// inline. Filing-status-aware brackets, MFJ/HoH thresholds, and
// inflation-adjusted future-year tables are deferred — see
// future-work/reports.md ("tax brackets — multi-filing-status engine
// integration").

import { REPORT_THEME } from "@/lib/reports/theme";

/** 2026 federal individual tax brackets — single filer. Tuples are
 *  [floor, ceiling, ratePercent]. The top bracket extends to Infinity. */
export const BRACKETS_2026_SINGLE: readonly (readonly [
  number,
  number,
  number,
])[] = [
  [0,        11_600,    10],
  [11_600,   47_150,    12],
  [47_150,   100_525,   22],
  [100_525,  191_950,   24],
  [191_950,  243_725,   32],
  [243_725,  609_350,   35],
  [609_350,  Infinity,  37],
] as const;

/** Per-bracket palette. Lower brackets sit in cool/calm tones (sage,
 *  steel) so the bottom of each stack reads as "fine"; upper brackets
 *  escalate through brand accent → plum → muted gray → crit so the
 *  reader's eye is drawn to the higher-rate dollars at the top of the
 *  stack. The 37% bracket reuses crit (the palette has six entries; we
 *  intentionally double the highest tier so the progression bottoms-out
 *  on the most alarming color). All values reference REPORT_THEME so a
 *  palette refresh propagates without touching this file.
 *
 *  Index layout:
 *    [0] 10% sage  (chart[1] / good)
 *    [1] 12% steel (chart[2])
 *    [2] 22% gold  (chart[0] / accent — middle bracket carries brand)
 *    [3] 24% plum  (chart[3])
 *    [4] 32% gray  (chart[5] / ink2 — neutral hand-off into red)
 *    [5] 35% red   (chart[4] / crit)
 *    [6] 37% red   (chart[4] / crit — repeat for top bracket) */
export const BRACKET_COLORS: readonly string[] = [
  REPORT_THEME.chartPalette[1], // good — sage
  REPORT_THEME.chartPalette[2], // steel
  REPORT_THEME.chartPalette[0], // accent — gold
  REPORT_THEME.chartPalette[3], // plum
  REPORT_THEME.chartPalette[5], // ink2 — gray
  REPORT_THEME.chartPalette[4], // crit — red
  REPORT_THEME.chartPalette[4], // crit — red (top bracket)
] as const;

export type BracketSlice = {
  /** Marginal rate as a percentage (10, 12, 22, …). */
  rate: number;
  /** Dollars of income falling into this bracket for one year. */
  amount: number;
  /** Bracket palette color. */
  color: string;
  /** Index into `BRACKETS_2026_SINGLE` (and `BRACKET_COLORS`). */
  bracketIndex: number;
};

/** Splits a single year's total taxable income into bracket buckets.
 *  Returns one slice per bracket (zero-amount slices are kept so the
 *  caller can stack consistently across years). */
export function splitIncomeIntoBrackets(income: number): BracketSlice[] {
  const safe = Math.max(0, income);
  return BRACKETS_2026_SINGLE.map(([floor, ceiling, rate], i) => {
    const span = ceiling - floor;
    const fill = Math.max(0, Math.min(safe - floor, span));
    return {
      rate,
      amount: Number.isFinite(fill) ? fill : 0,
      color: BRACKET_COLORS[i] ?? REPORT_THEME.chartPalette[5],
      bracketIndex: i,
    };
  });
}
