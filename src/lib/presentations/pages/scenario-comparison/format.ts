import { compactCurrency } from "@/lib/presentations/format";

/** Delegates to the shared compact formatter so this page's dollars read
 *  identically to every other sheet in the deck. */
export function fmtUsdCompact(n: number): string {
  return compactCurrency(n);
}

/** "82%", or an em-dash when the figure is unavailable. */
export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Signed dollar delta. Uses U+2212 MINUS, matching the sibling pages. */
export function fmtSignedUsd(delta: number): string {
  return delta >= 0
    ? `+${compactCurrency(delta)}`
    : `−${compactCurrency(Math.abs(delta))}`;
}

/** Signed percentage-point delta. Rounds each side BEFORE subtracting, so the
 *  printed delta can never contradict the two printed percentages — the
 *  established convention (see tax-comparison's effective-rate note). */
export function fmtSignedPts(baseFraction: number, colFraction: number): string {
  const pts = Math.round(colFraction * 100) - Math.round(baseFraction * 100);
  return `${pts >= 0 ? "+" : "−"}${Math.abs(pts)} pts`;
}
