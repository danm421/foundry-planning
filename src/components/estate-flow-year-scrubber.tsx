"use client";

import { useId } from "react";

interface EstateFlowYearScrubberProps {
  minYear: number;
  maxYear: number;
  value: number;
  onChange: (year: number) => void;
}

/**
 * Single-thumb year scrubber for the Estate Flow report. Picks the "as-of"
 * year column 1 is re-valued against. `minYear` is treated as "today".
 */
export function EstateFlowYearScrubber({
  minYear,
  maxYear,
  value,
  onChange,
}: EstateFlowYearScrubberProps) {
  const id = useId();
  const isToday = value <= minYear;

  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={id}
        className="text-xs font-medium text-[#7a7975]"
      >
        As of
      </label>

      <input
        id={id}
        type="range"
        min={minYear}
        max={maxYear}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="As-of year"
        className="h-1 w-48 cursor-pointer appearance-none rounded bg-[#1f2024] accent-[#d4a04a]"
      />

      <span className="min-w-[3.5rem] text-sm font-semibold tabular-nums text-[#e7e6e2]">
        {isToday ? "Today" : value}
      </span>

      <button
        type="button"
        onClick={() => onChange(minYear)}
        disabled={isToday}
        className="rounded border border-[#1f2024] px-2 py-0.5 text-xs font-medium text-[#7a7975] transition-colors hover:text-[#e7e6e2] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Today
      </button>
    </div>
  );
}
