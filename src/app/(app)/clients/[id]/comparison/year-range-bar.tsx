"use client";

import type { YearRange } from "@/lib/comparison/layout-schema";

interface Props {
  yearRange: YearRange | null;
  min: number;
  max: number;
  clientBirthYear: number | undefined;
  onChange: (next: YearRange) => void;
  onReset: () => void;
}

export function YearRangeBar({
  yearRange,
  min,
  max,
  clientBirthYear,
  onChange,
  onReset,
}: Props) {
  const start = yearRange?.start ?? min;
  const end = yearRange?.end ?? max;

  const handleStart = (next: number) => {
    if (Number.isNaN(next)) return;
    const clamped = Math.min(Math.max(next, min), end);
    onChange({ start: clamped, end });
  };

  const handleEnd = (next: number) => {
    if (Number.isNaN(next)) return;
    const clamped = Math.max(Math.min(next, max), start);
    onChange({ start, end: clamped });
  };

  const ageBadge = (() => {
    if (clientBirthYear === undefined) return null;
    const a1 = start - clientBirthYear;
    const a2 = end - clientBirthYear;
    return `Age ${a1} → Age ${a2}`;
  })();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-6 py-3">
      <span className="text-xs uppercase tracking-wide text-slate-400">
        Year range
      </span>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={end}
          value={start}
          onChange={(e) => handleStart(Number(e.target.value))}
          aria-label="Start year"
          className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
        <span className="text-slate-500">→</span>
        <input
          type="number"
          min={start}
          max={max}
          value={end}
          onChange={(e) => handleEnd(Number(e.target.value))}
          aria-label="End year"
          className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={start}
          onChange={(e) => handleStart(Number(e.target.value))}
          aria-label="Start year slider"
          className="w-32"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={end}
          onChange={(e) => handleEnd(Number(e.target.value))}
          aria-label="End year slider"
          className="w-32"
        />
      </div>

      {ageBadge && (
        <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
          {ageBadge}
        </span>
      )}

      {yearRange === null ? (
        <span className="text-xs italic text-slate-500">All years</span>
      ) : (
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          Reset
        </button>
      )}
    </div>
  );
}
