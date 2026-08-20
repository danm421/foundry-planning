"use client";
import type { ReactElement } from "react";

/**
 * One line-and-label key beneath a portal chart.
 *
 * Chart.js's own legend is a row of boxes that cannot say "this one is
 * dashed", which is the whole distinction both calculator charts need: the
 * solid line is what happens, the dashed one is what it is being measured
 * against. Drawing the key as an SVG line means the swatch is literally the
 * stroke it stands for.
 */
export function ChartLegendKey({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}): ReactElement {
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-3">
      <svg width="18" height="8" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="4"
          x2="18"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
