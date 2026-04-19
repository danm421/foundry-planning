// src/components/timeline/timeline-minimap.tsx
"use client";

import { useMemo, useRef } from "react";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineSparkline from "./timeline-sparkline";
import { CATEGORY_HEX } from "./timeline-category-pill";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  events: TimelineEvent[];
  visibleYearRange: { start: number; end: number } | null;
  onScrollToYear: (year: number) => void;
}

export default function TimelineMinimap({
  series,
  sparklineMode,
  events,
  visibleYearRange,
  onScrollToYear,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = 800; // logical width; component scales via CSS
  const height = 40;

  const pick = useMemo(() => {
    if (sparklineMode === "netWorth") return (p: SeriesPoint) => p.netWorth;
    if (sparklineMode === "portfolio") return (p: SeriesPoint) => p.portfolio;
    return (p: SeriesPoint) => p.netCashFlow;
  }, [sparklineMode]);

  if (series.length < 2) return null;

  const firstYear = series[0].year;
  const lastYear = series[series.length - 1].year;
  const span = Math.max(1, lastYear - firstYear);

  function xFor(year: number) {
    return ((year - firstYear) / span) * width;
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetYear = Math.round(firstYear + ratio * span);
    onScrollToYear(targetYear);
  };

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className="sticky top-[64px] z-20 w-full cursor-pointer rounded-md border border-gray-800 bg-gray-900/80 p-2 backdrop-blur"
    >
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0">
          <TimelineSparkline
            series={series}
            pick={pick}
            orientation="horizontal"
            width={width}
            height={height}
            strokeClass="stroke-blue-400"
          />
        </div>

        {visibleYearRange && (
          <div
            className="absolute top-0 h-full rounded bg-blue-500/10 ring-1 ring-blue-400/50"
            style={{
              left: `${(xFor(visibleYearRange.start) / width) * 100}%`,
              width: `${((xFor(visibleYearRange.end) - xFor(visibleYearRange.start)) / width) * 100}%`,
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5">
          {events.map((e) => (
            <span
              key={e.id}
              className="absolute bottom-0 h-1.5 w-[2px] rounded"
              style={{
                left: `${(xFor(e.year) / width) * 100}%`,
                backgroundColor: CATEGORY_HEX[e.category],
              }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>{firstYear}</span>
        <span>{lastYear}</span>
      </div>
    </div>
  );
}
