// src/components/timeline/timeline-year-segment.tsx
"use client";

import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineEventCard from "./timeline-event-card";

interface Props {
  year: number;
  ageLabel: string; // "Age 56" or "Ages 56 / 54"
  events: TimelineEvent[];
  spineHeight: number; // px — used by spine sparkline caller to align
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
  subjectLabelFor: (subject: TimelineEvent["subject"]) => string | undefined;
  isCoupled: boolean;
  registerSegmentRef: (year: number, el: HTMLDivElement | null) => void;
  alternate: boolean; // true = use alternating-sides layout (singles)
  alternateOffset: number; // index used to decide left/right for alternating singles
}

function sideFor(
  event: TimelineEvent,
  isCoupled: boolean,
  alternate: boolean,
  alternateIndex: number,
): "left" | "right" | "center" {
  if (event.subject === "joint") return "center";
  if (isCoupled) return event.subject === "primary" ? "left" : "right";
  if (alternate) return alternateIndex % 2 === 0 ? "left" : "right";
  return "left";
}

export default function TimelineYearSegment({
  year,
  ageLabel,
  events,
  spineHeight,
  expandedId,
  onToggleExpand,
  onHover,
  subjectLabelFor,
  isCoupled,
  registerSegmentRef,
  alternate,
  alternateOffset,
}: Props) {
  return (
    <div
      ref={(el) => registerSegmentRef(year, el)}
      data-timeline-year={year}
      className="grid grid-cols-[1fr_auto_1fr] gap-4 py-2"
      style={{ minHeight: events.length === 0 ? 20 : Math.max(spineHeight, 80) }}
    >
      {/* Left column */}
      <div className="flex flex-col items-end gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
          if (side !== "left") return null;
          return (
            <TimelineEventCard
              key={e.id}
              event={e}
              expanded={expandedId === e.id}
              onToggle={() => onToggleExpand(e.id)}
              onHover={(h) => onHover(h ? e.id : null)}
              subjectLabel={subjectLabelFor(e.subject)}
              side="left"
            />
          );
        })}
      </div>

      {/* Spine column */}
      <div className="flex w-20 flex-col items-center gap-1 border-x border-gray-800 px-2">
        <div className="text-xs tabular-nums text-gray-500">{year}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-600">{ageLabel}</div>
        {events.some((e) => sideFor(e, isCoupled, alternate, 0) === "center") && (
          <div className="mt-1 flex w-full flex-col gap-2">
            {events.map((e, i) => {
              const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
              if (side !== "center") return null;
              return (
                <TimelineEventCard
                  key={e.id}
                  event={e}
                  expanded={expandedId === e.id}
                  onToggle={() => onToggleExpand(e.id)}
                  onHover={(h) => onHover(h ? e.id : null)}
                  subjectLabel={undefined}
                  side="left"
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col items-start gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
          if (side !== "right") return null;
          return (
            <TimelineEventCard
              key={e.id}
              event={e}
              expanded={expandedId === e.id}
              onToggle={() => onToggleExpand(e.id)}
              onHover={(h) => onHover(h ? e.id : null)}
              subjectLabel={subjectLabelFor(e.subject)}
              side="right"
            />
          );
        })}
      </div>
    </div>
  );
}

// Also export for parent memoization helpers:
export { sideFor as _sideFor };
