"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";

const COLORS: Record<TimelineCategory, string> = {
  life: "bg-sky-400/10 text-sky-300 ring-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.15)]",
  income: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.15)]",
  transaction: "bg-amber-400/10 text-amber-300 ring-amber-400/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]",
  portfolio: "bg-blue-400/10 text-blue-300 ring-blue-400/40 shadow-[0_0_12px_rgba(96,165,250,0.15)]",
  insurance: "bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/40 shadow-[0_0_12px_rgba(232,121,249,0.15)]",
  tax: "bg-rose-400/10 text-rose-300 ring-rose-400/40 shadow-[0_0_12px_rgba(251,113,133,0.15)]",
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ${COLORS[category]}`}
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
  life: "#38BDF8",       // sky-400
  income: "#34D399",     // emerald-400
  transaction: "#FBBF24",// amber-400
  portfolio: "#60A5FA",  // blue-400
  insurance: "#E879F9",  // fuchsia-400
  tax: "#FB7185",        // rose-400
};
