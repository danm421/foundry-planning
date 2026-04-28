/**
 * ComparisonCell — single column of the 3-column comparison grid (Task 26).
 *
 * Pure presentational. Reads a `ScrubberCell` (label / pillLabel /
 * headlineLabel / bigNumber / subLine / rows) from `deriveScrubberData`
 * (Task 25) and renders it with variant-specific background + headline
 * colors.
 *
 * Token translations from the plan pseudocode (Task 26 § comparison-cell):
 *   bg-bg-0       → bg-card
 *   bg-bg-1       → bg-card-2
 *   text-fg-0     → text-ink
 *   text-fg-3     → text-ink-3
 *   text-accent-hi → text-accent-ink (Task 18 token rename)
 *   bg-fg-3       → bg-ink-3
 *   bg-neg        → bg-crit
 */

import MoneyText from "@/components/money-text";
import type { ScrubberCell, RowSentiment } from "./lib/derive-scrubber-data";

interface Props {
  cell: ScrubberCell;
  variant: "without" | "with" | "impact";
}

const VARIANT_BG: Record<Props["variant"], string> = {
  without: "bg-card",
  with: "bg-card-2",
  impact: "bg-gradient-to-br from-accent/5 to-accent/15",
};

export function ComparisonCell({ cell, variant }: Props) {
  const bg = VARIANT_BG[variant];
  const headlineColor =
    variant === "without" ? "text-ink" : "text-accent-ink";

  return (
    <div className={`p-4 ${bg}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-3">
          {cell.label}
        </span>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] text-accent">
          {cell.pillLabel}
        </span>
      </div>
      <div className={`mb-1 text-[13px] font-semibold ${headlineColor}`}>
        {cell.headlineLabel}
      </div>
      <MoneyText
        value={cell.bigNumber}
        format="currency"
        className="text-[30px] font-mono tabular-nums"
      />
      <div className="mb-3 text-[11px] text-ink-3">{cell.subLine}</div>
      <ul className="space-y-1 text-[12px]">
        {cell.rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${sentimentColor(r.sentiment)}`}
              aria-hidden="true"
            />
            <span className="flex-1">{r.label}</span>
            <span className="font-mono tabular-nums">{r.valueText}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sentimentColor(s: RowSentiment): string {
  return { neutral: "bg-ink-3", pos: "bg-accent", neg: "bg-crit" }[s];
}
