"use client";

import type { ReactNode } from "react";

interface Props {
  /** Technique noun, e.g. "Roth conversion". Also drives the accessible name. */
  label: string;
  /** One short line orienting an advisor who doesn't know the term. */
  blurb: string;
  /** How many of this technique the scenario already holds. Hidden when 0 or
   *  absent (singletons like Estate planning pass nothing). */
  count?: number;
  icon: ReactNode;
  onClick: () => void;
}

/**
 * One tile in the technique catalog. Clicking it opens that technique's dialog;
 * the techniques it produces are listed above the grid. The card stays put
 * after use — a scenario can hold several conversions, sales, or paydowns, so
 * "add another" is always one click.
 */
export function SolverTechniqueCard({ label, blurb, count, icon, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? `Add ${label} (${count} in this scenario)` : `Add ${label}`}
      className="group flex h-full flex-col gap-1.5 rounded-md border border-hair-2 bg-card-2 p-3 text-left transition-colors hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="shrink-0 text-ink-3 transition-colors group-hover:text-accent">
          {icon}
        </span>
        {count ? (
          <span className="tabular shrink-0 rounded-sm border border-hair px-1.5 py-0.5 text-[10px] leading-none text-ink-3">
            {count}
          </span>
        ) : null}
      </div>
      <span className="text-[13px] font-medium leading-tight text-ink">{label}</span>
      <span className="text-[11px] leading-snug text-ink-4">{blurb}</span>
    </button>
  );
}
