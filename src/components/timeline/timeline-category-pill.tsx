"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";

const COLORS: Record<TimelineCategory, string> = {
  life: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  income: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  transaction: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  portfolio: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  insurance: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  tax: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

/** Plural label for category legends / filters. */
export const CATEGORY_LEGEND_LABEL: Record<TimelineCategory, string> = {
  life: "Life",
  income: "Income",
  transaction: "Transactions",
  portfolio: "Portfolio",
  insurance: "Insurance",
  tax: "Tax",
};

const LABELS = CATEGORY_LEGEND_LABEL;

interface Props {
  category: TimelineCategory;
}

export default function TimelineCategoryPill({ category }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${COLORS[category]}`}
    >
      {LABELS[category]}
    </span>
  );
}

export function categoryAccentClass(category: TimelineCategory): string {
  return COLORS[category];
}

/** Hex color per category — used by the mini-map tick marks, footer legend, and future spine dots. */
export const CATEGORY_HEX: Record<TimelineCategory, string> = {
  life: "#38bdf8",
  income: "#34d399",
  transaction: "#fbbf24",
  portfolio: "#60a5fa",
  insurance: "#d946ef",
  tax: "#fb7185",
};
