// Compact USD for the Retirement Comparison page — $X.XM / $XXXK / $X.
// Shared by metrics, page-pdf, and the AI prompt builder so the rounding
// rules live in one place.
export function fmtUsdCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}
