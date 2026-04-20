"use client";

import Link from "next/link";
import type { TimelineEvent } from "@/lib/timeline/timeline-types";
import TimelineCategoryPill, { CATEGORY_HEX } from "./timeline-category-pill";

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
  const accentHex = CATEGORY_HEX[event.category];

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      // side = which side of the spine we're on; align flush to the spine-adjacent edge.
      className={`group relative w-full rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm shadow-sm transition-all hover:border-white/[0.12] font-[family-name:var(--font-body)] ${
        side === "left" ? "ml-auto max-w-[460px]" : "mr-auto max-w-[460px]"
      }`}
      style={{
        boxShadow: expanded
          ? `0 0 0 1px ${accentHex}33, 0 10px 30px -10px ${accentHex}55`
          : undefined,
      }}
    >
      {/* Vertical accent line on the spine-facing edge */}
      <span
        aria-hidden
        className={`absolute top-3 bottom-3 w-[2px] rounded-full ${
          side === "left" ? "right-0" : "left-0"
        }`}
        style={{ backgroundColor: accentHex, opacity: 0.55 }}
      />
      {/* Horizontal connector line reaching toward the spine */}
      <span
        aria-hidden
        className={`absolute top-1/2 h-px w-12 -translate-y-1/2 ${
          side === "left" ? "right-[-3rem]" : "left-[-3rem]"
        }`}
        style={{
          background:
            side === "left"
              ? `linear-gradient(to right, ${accentHex}00, ${accentHex}aa)`
              : `linear-gradient(to left, ${accentHex}00, ${accentHex}aa)`,
        }}
      />

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
        className="block w-full p-4 text-left"
        onMouseOver={(e) => {
          e.currentTarget.parentElement?.style.setProperty(
            "box-shadow",
            `0 10px 30px -12px ${accentHex}44`,
          );
        }}
        onMouseOut={(e) => {
          if (!expanded) {
            e.currentTarget.parentElement?.style.removeProperty("box-shadow");
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <TimelineCategoryPill category={event.category} />
          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] tabular-nums text-gray-400 font-[family-name:var(--font-display)]">
            {event.year}
            {event.age != null ? ` · age ${event.age}` : ""}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div
            className="text-base font-semibold text-gray-50 font-[family-name:var(--font-display)]"
            style={{ fontOpticalSizing: "auto" }}
          >
            {event.title}
          </div>
          {subjectLabel && (
            <div className="text-[11px] uppercase tracking-[0.08em] text-gray-500">
              {subjectLabel}
            </div>
          )}
        </div>
        {event.supportingFigure && (
          <div className="mt-1 text-xs tabular-nums text-gray-400">{event.supportingFigure}</div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] p-4 text-xs">
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
                  className="text-[11px] text-sky-300 hover:text-sky-200"
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
