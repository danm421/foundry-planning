// src/components/portal/asset-type-pie.tsx
import type { ReactElement } from "react";
import { CATEGORY_COLORS } from "@/lib/portal/account-rail";
import type { NetWorthGroupLine } from "@/lib/portal/contracts";
import { fmtUsd } from "@/lib/portal/format";

/**
 * Asset mix as a pie with the legend beside it. Inline SVG rather than
 * Chart.js — the dashboard tiles paint their own small charts (see
 * `PaceSparkline`), which keeps the fills on `var(--data-*)` so they follow a
 * theme toggle without a canvas repaint.
 */

const SIZE = 100; // viewBox units; the rendered size comes from the class below
const C = SIZE / 2;
const R = SIZE / 2;

/** Wedge spanning `from`..`to`, each a fraction of the whole turn from 12 o'clock. */
function wedge(from: number, to: number): string {
  const a0 = from * 2 * Math.PI - Math.PI / 2;
  const a1 = to * 2 * Math.PI - Math.PI / 2;
  const x0 = C + R * Math.cos(a0);
  const y0 = C + R * Math.sin(a0);
  const x1 = C + R * Math.cos(a1);
  const y1 = C + R * Math.sin(a1);
  return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

/** A category holding a real balance never reads as 0% — it rounds up to "<1%". */
function fmtShare(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}

export function AssetTypePie({ groups }: { groups: NetWorthGroupLine[] }): ReactElement | null {
  const slices = groups.filter((g) => g.total > 0);
  if (slices.length === 0) return null;

  // Shares are taken against the summed slices, not the tile's asset total: a
  // category the pie can't draw (zero or negative) would otherwise leave the
  // ring short of a full turn and the percentages short of 100.
  const sum = slices.reduce((s, g) => s + g.total, 0);
  const wedges = [];
  let cursor = 0;
  for (const g of slices) {
    const share = g.total / sum;
    wedges.push({
      ...g,
      share,
      d: wedge(cursor, cursor + share),
      color: CATEGORY_COLORS[g.category] ?? "var(--data-grey)",
    });
    cursor += share;
  }

  return (
    <div className="flex items-center gap-4">
      {/* Decorative: the legend beside it carries every label and number. */}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-[104px] w-[104px] shrink-0" aria-hidden>
        {wedges.length === 1 ? (
          // A lone slice is a full turn, where start and end angles coincide and
          // the arc command degenerates to nothing.
          <circle cx={C} cy={C} r={R} fill={wedges[0].color} />
        ) : (
          wedges.map((w) => (
            <path
              key={w.category}
              d={w.d}
              fill={w.color}
              stroke="var(--color-card)"
              strokeWidth={1}
            />
          ))
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {wedges.map((w) => (
          <li key={w.category} className="flex items-center gap-2 text-[13px]">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: w.color }}
            />
            <span className="truncate text-ink-2">{w.label}</span>
            <span className="tabular ml-auto shrink-0 text-ink">{fmtUsd(w.total)}</span>
            <span className="tabular w-10 shrink-0 text-right text-ink-3">
              {fmtShare(w.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
