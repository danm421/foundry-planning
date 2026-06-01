"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";
import { colors, data as brandData } from "@/brand";

const COLORS: Record<TimelineCategory, string> = {
  life: "bg-sky-400/10 text-sky-300 ring-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.15)]",
  income: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.15)]",
  transaction: "bg-amber-400/10 text-amber-300 ring-amber-400/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]",
  portfolio: "bg-blue-400/10 text-blue-300 ring-blue-400/40 shadow-[0_0_12px_rgba(96,165,250,0.15)]",
  insurance: "bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/40 shadow-[0_0_12px_rgba(232,121,249,0.15)]",
  tax: "bg-rose-400/10 text-rose-300 ring-rose-400/40 shadow-[0_0_12px_rgba(251,113,133,0.15)]",
  estate: "bg-violet-400/10 text-violet-300 ring-violet-400/40 shadow-[0_0_12px_rgba(167,139,250,0.15)]",
  strategy: "bg-teal-400/10 text-teal-300 ring-teal-400/40 shadow-[0_0_12px_rgba(45,212,191,0.15)]",
};

/** Plural label for category legends / filters. */
export const CATEGORY_LEGEND_LABEL: Record<TimelineCategory, string> = {
  life: "Life",
  income: "Income",
  transaction: "Transactions",
  portfolio: "Portfolio",
  insurance: "Insurance",
  tax: "Tax",
  estate: "Estate",
  strategy: "Strategy",
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

/** Hex color per category — used by the mini-map tick marks, footer legend, and future spine dots.
 *  Values are resolved from the brand `colors` object (dark-mode tokens) so they stay in sync
 *  with globals.css `--color-cat-*`. Light-mode theming of canvas-drawn elements is a future task.
 */
export const CATEGORY_HEX: Record<TimelineCategory, string> = {
  life: colors.cat.life,
  income: colors.cat.income,
  transaction: colors.cat.tax,     // transactions use the amber/tax hue
  portfolio: colors.cat.portfolio,
  insurance: colors.cat.insurance,
  tax: brandData.rose,             // tax uses data-rose for contrast against transaction amber
  estate: brandData.violet,        // estate uses data-violet
  strategy: brandData.emerald,     // strategy uses data-emerald
};
