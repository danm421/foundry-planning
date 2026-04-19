// src/components/timeline/timeline-spine.tsx
"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineYearSegment from "./timeline-year-segment";

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
  sparklineMode,
  expandedId,
  onToggleExpand,
  onHover,
  primaryLabel,
  spouseLabel,
  isCoupled,
  registerSegmentRef,
}: Props) {
  // Group events by year.
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

  // Cumulative offset used to alternate sides deterministically for singles.
  let alternateIndex = 0;

  return (
    <div className="mt-6 flex flex-col">
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
