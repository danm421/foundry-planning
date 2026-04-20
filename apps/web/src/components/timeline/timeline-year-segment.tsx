// src/components/timeline/timeline-year-segment.tsx
"use client";

import type { TimelineEvent } from "@/lib/timeline/timeline-types";
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
  alternate: boolean; // retained for compatibility; singles always alternate
  alternateOffset: number; // index used to decide left/right for alternating events
  rowIndex?: number; // used for fade-in animation delay
}

function sideFor(
  event: TimelineEvent,
  isCoupled: boolean,
  alternateIndex: number,
): "left" | "right" {
  // Joint events always alternate (even in couples) to use horizontal space well.
  if (event.subject === "joint") {
    return alternateIndex % 2 === 0 ? "left" : "right";
  }
  if (isCoupled) {
    return event.subject === "primary" ? "left" : "right";
  }
  // Singles: alternate by index
  return alternateIndex % 2 === 0 ? "left" : "right";
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
  alternateOffset,
  rowIndex = 0,
}: Props) {
  const populated = events.length > 0;
  const ageWithoutPrefix = ageLabel.replace(/^Ages?\s*/i, "");
  const fadeDelay = `${Math.min(rowIndex * 30, 800)}ms`;

  return (
    <div
      ref={(el) => registerSegmentRef(year, el)}
      data-timeline-year={year}
      className="timeline-fade-in grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] gap-x-12 py-1.5 opacity-0"
      style={{
        minHeight: populated ? Math.max(spineHeight, 72) : 12,
        animation: "timelineFadeIn 0.5s ease-out forwards",
        animationDelay: fadeDelay,
      }}
    >
      {/* Left column */}
      <div className="flex flex-col items-end gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternateOffset + i);
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

      {/* Spine column — year chip only */}
      <div className="relative flex w-[72px] flex-col items-center gap-1 px-1">
        {populated ? (
          <div className="flex flex-col items-center gap-0.5 rounded-full border border-white/10 bg-black/40 px-2 py-1 backdrop-blur-sm">
            <span className="text-xs tabular-nums text-gray-200 font-[family-name:var(--font-display)]">
              {year}
            </span>
            <span className="text-[9px] uppercase tracking-[0.08em] text-gray-500 font-[family-name:var(--font-body)]">
              {ageWithoutPrefix}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 rounded-full border border-white/5 bg-black/20 px-2 py-0.5">
            <span className="text-[10px] tabular-nums text-gray-600 font-[family-name:var(--font-display)]">
              {year}
            </span>
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col items-start gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternateOffset + i);
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
