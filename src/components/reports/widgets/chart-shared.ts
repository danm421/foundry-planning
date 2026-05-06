// src/components/reports/widgets/chart-shared.ts
//
// Shared formatters + small helpers for the on-screen Chart.js widgets.
// Keep this file framework-light: no React, no @react-pdf/renderer, no
// chart.js imports. The PDF side has its own copy of `fmtCompactDollar`
// in `components/reports-pdf/pdf-chart-primitives.tsx` — we deliberately
// duplicate the few tiny formatters rather than cross-import the PDF
// module (which would drag `@react-pdf/renderer` into the client bundle).

/** Compact-dollar formatting for axis ticks and value labels.
 *  >=1e6 → "$1.2M", >=1e3 → "$340K", otherwise "$50". Negatives wrap in
 *  parens (financial convention). Mirrors the PDF formatter so screen
 *  and PDF axis labels read identically. */
export function fmtCompactDollar(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e6) {
    s = `$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  } else if (abs >= 1e3) {
    s = `$${(abs / 1e3).toFixed(0)}K`;
  } else {
    s = `$${abs.toFixed(0)}`;
  }
  return n < 0 ? `(${s})` : s;
}
