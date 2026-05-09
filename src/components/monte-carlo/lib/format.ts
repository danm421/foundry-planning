// Minus sign U+2212 (not ASCII hyphen) — renders cleanly in tabular-nums
// and aligns with accounting-minus conventions already used elsewhere in
// the dark theme.
const MINUS = "\u2212";

export function formatShortCurrency(value: number): string {
  const sign = value < 0 ? MINUS : "";
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}$${Math.round(n / 1_000)}K`;
  return `${sign}$${Math.round(n)}`;
}

export function formatCurrency(value: number): string {
  const sign = value < 0 ? MINUS : "";
  const n = Math.abs(value);
  return `${sign}$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatPercent2(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

export function formatInteger(n: number): string {
  return n.toLocaleString("en-US");
}
