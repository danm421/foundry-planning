// Year-range picker used by every cash-flow drill-down page. Mirrors the UI
// in pages/cash-flow/options-control.tsx so the parent Cash Flow page and
// its drill-downs feel consistent.

"use client";

import type { DrillPageOptions } from "@/lib/presentations/shared/drill-types";

interface Props {
  value: DrillPageOptions;
  onChange: (next: DrillPageOptions) => void;
}

const CURRENT_YEAR = new Date().getFullYear();

export function DrillOptionsControl({ value, onChange }: Props) {
  const isCustom = typeof value.range === "object";
  const startYear = isCustom
    ? (value.range as { startYear: number }).startYear
    : CURRENT_YEAR;
  const endYear = isCustom
    ? (value.range as { endYear: number }).endYear
    : CURRENT_YEAR + 30;

  return (
    <div className="space-y-3 text-sm text-ink-2">
      <fieldset className="space-y-1">
        <legend className="sr-only">Range</legend>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.range === "retirement"}
            onChange={() => onChange({ ...value, range: "retirement" })}
          />
          <span>Retirement only</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.range === "lifetime"}
            onChange={() => onChange({ ...value, range: "lifetime" })}
          />
          <span>Lifetime</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={isCustom}
            onChange={() =>
              onChange({ ...value, range: { startYear, endYear } })
            }
          />
          <span>Custom range</span>
        </label>
      </fieldset>
      {isCustom && (
        <div className="flex items-center gap-3 pl-6">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
              Start year
            </span>
            <input
              type="number"
              aria-label="Start year"
              className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={startYear}
              onChange={(e) =>
                onChange({
                  ...value,
                  range: { startYear: Number(e.target.value), endYear },
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
              End year
            </span>
            <input
              type="number"
              aria-label="End year"
              className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={endYear}
              onChange={(e) =>
                onChange({
                  ...value,
                  range: { startYear, endYear: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
