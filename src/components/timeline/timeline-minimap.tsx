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
      className="sticky top-[64px] z-20 w-full cursor-pointer rounded-lg border border-slate-800 bg-slate-900/70 p-2 backdrop-blur-md font-[family-name:var(--font-body)]"
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
            className="absolute top-0 h-full rounded-lg bg-white/5 ring-1 ring-sky-400/50 shadow-[0_0_14px_rgba(56,189,248,0.3)]"
            style={{
              left: `${(xFor(visibleYearRange.start) / width) * 100}%`,
              width: `${((xFor(visibleYearRange.end) - xFor(visibleYearRange.start)) / width) * 100}%`,
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-2.5">
          {events.map((e) => {
            const color = CATEGORY_HEX[e.category];
            return (
              <span
                key={e.id}
                className="absolute bottom-0 rounded-full"
                style={{
                  left: `${(xFor(e.year) / width) * 100}%`,
                  width: "1.5px",
                  height: "10px",
                  backgroundColor: color,
                  boxShadow: `0 0 6px ${color}`,
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums text-gray-400">
        <span>{firstYear}</span>
        <span>{lastYear}</span>
      </div>
    </div>
  );
}
