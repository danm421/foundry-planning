// src/components/timeline/timeline-controls.tsx
"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

const CATEGORIES: { id: TimelineCategory; label: string }[] = [
  { id: "life", label: "Life" },
  { id: "income", label: "Income" },
  { id: "transaction", label: "Transactions" },
  { id: "portfolio", label: "Portfolio" },
  { id: "insurance", label: "Insurance" },
  { id: "tax", label: "Tax" },
];

const CHIP_ACTIVE: Record<TimelineCategory, string> = {
  life: "border-sky-400/40 bg-sky-400/10 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.2)]",
  income:
    "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)]",
  transaction:
    "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.2)]",
  portfolio:
    "border-blue-400/40 bg-blue-400/10 text-blue-300 shadow-[0_0_12px_rgba(96,165,250,0.2)]",
  insurance:
    "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 shadow-[0_0_12px_rgba(232,121,249,0.2)]",
  tax: "border-rose-400/40 bg-rose-400/10 text-rose-300 shadow-[0_0_12px_rgba(251,113,133,0.2)]",
};

interface Props {
  sparklineMode: SparklineMode;
  onSparklineModeChange: (mode: SparklineMode) => void;
  activeCategories: Set<TimelineCategory>;
  onToggleCategory: (cat: TimelineCategory) => void;
}

export default function TimelineControls({
  sparklineMode,
  onSparklineModeChange,
  activeCategories,
  onToggleCategory,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-white/[0.06] pb-4 font-[family-name:var(--font-body)]">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1 backdrop-blur-sm">
        {[
          { id: "netWorth", label: "Net Worth" },
          { id: "portfolio", label: "Portfolio" },
          { id: "netCashFlow", label: "Net Cash Flow" },
        ].map((opt) => {
          const active = sparklineMode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSparklineModeChange(opt.id as SparklineMode)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                active
                  ? "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/40 shadow-[0_0_10px_rgba(56,189,248,0.2)]"
                  : "text-gray-300 hover:text-gray-200"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = activeCategories.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggleCategory(c.id)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                active
                  ? CHIP_ACTIVE[c.id]
                  : "border-white/10 text-gray-300 hover:border-white/25 hover:text-gray-300"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
