// src/lib/presentations/pages/scenario-comparison/badges.ts
import type { MetricRow } from "./types";

/** Row label to badge text, in priority order. A column earns a badge for each
 *  row it wins; only the two highest-priority ones are printed, so a column
 *  that sweeps the sheet does not turn into a wall of chips. */
const BADGE_BY_ROW: Array<{ label: string; badge: string }> = [
  { label: "Plan confidence", badge: "Best odds" },
  { label: "Max sustainable spending", badge: "Most spendable" },
  { label: "Lifetime taxes — total", badge: "Lowest tax" },
  { label: "Assets end of life", badge: "Most assets" },
  { label: "Net to heirs", badge: "Largest legacy" },
];

const MAX_BADGES_PER_COLUMN = 2;

export function buildBadges(rows: MetricRow[], columnCount: number): string[][] {
  const out: string[][] = Array.from({ length: columnCount }, () => []);
  for (const { label, badge } of BADGE_BY_ROW) {
    const row = rows.find((r) => r.label === label);
    if (!row) continue; // row hidden (max-spend off, no estate data, ...)
    const winner = row.cells.findIndex((c) => c.isBest);
    if (winner < 0 || winner >= columnCount) continue;
    if (out[winner].length < MAX_BADGES_PER_COLUMN) out[winner].push(badge);
  }
  return out;
}
