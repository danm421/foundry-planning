// src/components/timeline/timeline-spine.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionYear } from "@foundry/engine";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineYearSegment from "./timeline-year-segment";
import TimelineSparkline from "./timeline-sparkline";
import { CATEGORY_HEX } from "./timeline-category-pill";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  projection: ProjectionYear[];
  visibleEvents: TimelineEvent[];
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
  hoveredEventId: string | null;
  primaryLabel: string;
  spouseLabel: string | null;
  isCoupled: boolean;
  registerSegmentRef: (year: number, el: HTMLDivElement | null) => void;
}

export default function TimelineSpine({
  projection,
  visibleEvents,
  series,
  sparklineMode,
  expandedId,
  onToggleExpand,
  onHover,
  hoveredEventId,
  primaryLabel,
  spouseLabel,
  isCoupled,
  registerSegmentRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pick = useMemo(() => {
    if (sparklineMode === "netWorth") return (p: SeriesPoint) => p.netWorth;
    if (sparklineMode === "portfolio") return (p: SeriesPoint) => p.portfolio;
    return (p: SeriesPoint) => p.netCashFlow;
  }, [sparklineMode]);

  const eventsByYear = useMemo(() => {
    const m = new Map<number, TimelineEvent[]>();
    for (const e of visibleEvents) {
      const list = m.get(e.year) ?? [];
      list.push(e);
      m.set(e.year, list);
    }
    return m;
  }, [visibleEvents]);

  const subjectLabelFor = (subject: TimelineEvent["subject"]) => {
    if (subject === "primary") return primaryLabel;
    if (subject === "spouse") return spouseLabel ?? undefined;
    return undefined;
  };

  // Precompute per-year offsets before render (avoid mutation inside .map).
  // When coupled: only joint events alternate (primary/spouse are side-fixed), so we count joint only.
  // When uncoupled: every event alternates by index, so we count all prior events.
  const yearPlan = useMemo(
    () =>
      projection.reduce<
        { py: ProjectionYear; events: TimelineEvent[]; alternateOffset: number }[]
      >((acc, py) => {
        const events = eventsByYear.get(py.year) ?? [];
        const prev = acc[acc.length - 1];
        const countFn = (e: TimelineEvent) =>
          isCoupled ? e.subject === "joint" : true;
        const alternateOffset = prev
          ? prev.alternateOffset + prev.events.filter(countFn).length
          : 0;
        acc.push({ py, events, alternateOffset });
        return acc;
      }, []),
    [projection, eventsByYear, isCoupled],
  );

  return (
    <div ref={containerRef} className="relative mt-6 flex flex-col">
      {/* Thin gradient spine line behind the year segments */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2"
        style={{
          background:
            "linear-gradient(180deg, rgba(56,189,248,0.6) 0%, rgba(96,165,250,0.4) 50%, rgba(232,121,249,0.3) 100%)",
          filter: "drop-shadow(0 0 6px rgba(96,165,250,0.25))",
        }}
      />

      <div
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
        style={{ width: 80, height: dims.height }}
      >
        {dims.height > 0 && (
          <TimelineSparkline
            series={series}
            pick={pick}
            orientation="vertical"
            width={80}
            height={dims.height}
            strokeClass="stroke-blue-400/60"
          />
        )}
        {dims.height > 0 &&
          visibleEvents.map((e) => {
            const idx = projection.findIndex((py) => py.year === e.year);
            if (idx < 0) return null;
            const top = (idx / Math.max(1, projection.length - 1)) * dims.height;
            const isHover = hoveredEventId === e.id;
            const color = CATEGORY_HEX[e.category];
            return (
              <span
                key={e.id}
                className="absolute left-1/2 -translate-x-1/2 rounded-full transition-all"
                style={{
                  top,
                  width: isHover ? 12 : 6,
                  height: isHover ? 12 : 6,
                  marginTop: isHover ? -6 : -3,
                  backgroundColor: color,
                  boxShadow: isHover
                    ? `0 0 0 4px ${color}33, 0 0 12px ${color}88`
                    : `0 0 6px ${color}66`,
                }}
              />
            );
          })}
      </div>

      {yearPlan.map(({ py, events, alternateOffset }, rowIndex) => {
        const ageLabel = py.ages.spouse != null
          ? `Ages ${py.ages.client} / ${py.ages.spouse}`
          : `Age ${py.ages.client}`;
        return (
          <TimelineYearSegment
            key={py.year}
            year={py.year}
            ageLabel={ageLabel}
            events={events}
            spineHeight={80}
            expandedId={expandedId}
            onToggleExpand={onToggleExpand}
            onHover={onHover}
            subjectLabelFor={subjectLabelFor}
            isCoupled={isCoupled}
            registerSegmentRef={registerSegmentRef}
            alternate={true}
            alternateOffset={alternateOffset}
            rowIndex={rowIndex}
          />
        );
      })}
    </div>
  );
}
