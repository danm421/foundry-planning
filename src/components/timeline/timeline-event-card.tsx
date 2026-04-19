"use client";

import Link from "next/link";
import type { TimelineEvent } from "@/lib/timeline/timeline-types";
import TimelineCategoryPill from "./timeline-category-pill";

interface Props {
  event: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
  onHover: (hovered: boolean) => void;
  subjectLabel?: string; // "Dan" / "Jane" / undefined
  side: "left" | "right";
}

export default function TimelineEventCard({
  event,
  expanded,
  onToggle,
  onHover,
  subjectLabel,
  side,
}: Props) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      // side = which side of the spine we're on; ml-auto aligns to the spine-adjacent edge.
      className={`group w-full max-w-sm rounded-md border border-gray-800 bg-gray-900/60 shadow-sm transition-shadow hover:shadow-md ${
        side === "left" ? "ml-auto" : "mr-auto"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={(e) => {
          // <button> natively fires onClick on Enter/Space — do not duplicate.
          // Escape collapses an expanded card (native buttons don't do this).
          if (e.key === "Escape" && expanded) {
            onToggle();
          }
        }}
        aria-expanded={expanded}
        className="block w-full p-3 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <TimelineCategoryPill category={event.category} />
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-400">
            {event.year}
            {event.age != null ? ` · age ${event.age}` : ""}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-gray-100">{event.title}</div>
          {subjectLabel && <div className="text-[11px] text-gray-500">{subjectLabel}</div>}
        </div>
        {event.supportingFigure && (
          <div className="mt-0.5 text-xs text-gray-400">{event.supportingFigure}</div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-3 text-xs">
          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3">
            {event.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-gray-500">{d.label}</dt>
                <dd className="tabular-nums text-gray-200">{d.value}</dd>
              </div>
            ))}
          </dl>
          {event.links && event.links.length > 0 && (
            <div className="mt-3 flex gap-3">
              {event.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[11px] text-blue-400 hover:text-blue-300"
                >
                  {l.label} →
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
