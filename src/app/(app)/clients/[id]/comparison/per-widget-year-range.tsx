"use client";

import type { YearRange } from "@/lib/comparison/layout-schema";

interface Props {
  min: number;
  max: number;
  yearRange: YearRange | undefined;
  onChange: (next: YearRange | undefined) => void;
}

export function PerWidgetYearRange({ min, max, yearRange, onChange }: Props) {
  const start = yearRange?.start ?? min;
  const end = yearRange?.end ?? max;

  const setStart = (v: number) => {
    const clamped = Math.min(Math.max(v, min), end);
    onChange({ start: clamped, end });
  };
  const setEnd = (v: number) => {
    const clamped = Math.max(Math.min(v, max), start);
    onChange({ start, end: clamped });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
      <label className="flex items-center gap-1">
        Start
        <input
          type="number"
          min={min}
          max={end}
          value={start}
          onChange={(e) => setStart(Number(e.target.value))}
          className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-100"
        />
      </label>
      <label className="flex items-center gap-1">
        End
        <input
          type="number"
          min={start}
          max={max}
          value={end}
          onChange={(e) => setEnd(Number(e.target.value))}
          className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-100"
        />
      </label>
      {yearRange ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
        >
          All years
        </button>
      ) : (
        <span className="italic text-slate-500">All years</span>
      )}
    </div>
  );
}
