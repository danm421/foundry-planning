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
    <div className="flex flex-wrap items-center gap-4 border-b border-gray-800 pb-4">
      <div className="flex items-center gap-1 rounded-md border border-gray-700 p-1">
        {[
          { id: "netWorth", label: "Net Worth" },
          { id: "portfolio", label: "Portfolio" },
          { id: "netCashFlow", label: "Net Cash Flow" },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSparklineModeChange(opt.id as SparklineMode)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              sparklineMode === opt.id
                ? "bg-blue-500/20 text-blue-300"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border border-blue-400/60 bg-blue-500/10 text-blue-300"
                  : "border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300"
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
