// src/components/timeline/timeline-spine.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionYear } from "@/engine";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineYearSegment from "./timeline-year-segment";
import TimelineSparkline from "./timeline-sparkline";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  projection: ProjectionYear[];
  visibleEvents: TimelineEvent[];
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
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

  let alternateIndex = 0;

  return (
    <div ref={containerRef} className="relative mt-6 flex flex-col">
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
            strokeClass="stroke-blue-500/40"
          />
        )}
      </div>

      {projection.map((py) => {
        const events = eventsByYear.get(py.year) ?? [];
        const ageLabel = py.ages.spouse != null
          ? `Ages ${py.ages.client} / ${py.ages.spouse}`
          : `Age ${py.ages.client}`;
        const segment = (
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
            alternate={!isCoupled}
            alternateOffset={alternateIndex}
          />
        );
        alternateIndex += events.filter((e) => e.subject !== "joint").length;
        return segment;
      })}
    </div>
  );
}
