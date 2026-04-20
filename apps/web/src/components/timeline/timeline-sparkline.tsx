// src/components/timeline/timeline-sparkline.tsx
"use client";

import type { SeriesPoint } from "@/lib/timeline/timeline-types";

type Orientation = "horizontal" | "vertical";

interface Props {
  series: SeriesPoint[];
  pick: (p: SeriesPoint) => number;
  orientation: Orientation;
  width: number;
  height: number;
  strokeClass?: string;
  zeroStrokeClass?: string;
}

/**
 * Render a normalized path for a numeric series. Min/max are computed from the
 * provided `pick` so callers can swap net worth / portfolio / net cash flow
 * without re-normalizing at the callsite. Values at or below the min clamp to
 * the edge of the axis.
 */
export default function TimelineSparkline({
  series,
  pick,
  orientation,
  width,
  height,
  strokeClass = "stroke-blue-400",
  zeroStrokeClass = "stroke-gray-700",
}: Props) {
  if (series.length < 2) return <svg width={width} height={height} />;

  const values = series.map(pick);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(1, max - min);

  const n = series.length;
  // Horizontal mode: time runs left-to-right on x, values map to y.
  // Vertical mode: time runs top-to-bottom on y, values map to x.
  function pointFor(i: number): { x: number; y: number } {
    const t = i / Math.max(1, n - 1);
    const v = (values[i] - min) / span;
    if (orientation === "horizontal") {
      return { x: t * width, y: height - v * height };
    }
    return { x: v * width, y: t * height };
  }

  const d = values
    .map((_, i) => {
      const { x, y } = pointFor(i);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Zero axis (only if zero is within span). In horizontal mode the zero line is
  // horizontal at a fixed y; in vertical mode it is vertical at a fixed x.
  const zeroShown = min < 0 && max > 0;
  const zeroValue = (0 - min) / span;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {zeroShown && (
        orientation === "horizontal" ? (
          <line x1={0} x2={width} y1={height - zeroValue * height} y2={height - zeroValue * height} className={zeroStrokeClass} strokeDasharray="2 3" />
        ) : (
          <line x1={zeroValue * width} x2={zeroValue * width} y1={0} y2={height} className={zeroStrokeClass} strokeDasharray="2 3" />
        )
      )}
      <path d={d} fill="none" className={strokeClass} strokeWidth={1.5} />
    </svg>
  );
}
