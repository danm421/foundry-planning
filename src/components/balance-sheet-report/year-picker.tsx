// src/components/balance-sheet-report/year-picker.tsx
"use client";

interface YearPickerProps {
  years: number[];
  value: number;
  onChange: (year: number) => void;
}

export default function YearPicker({ years, value, onChange }: YearPickerProps) {
  const idx = years.indexOf(value);
  const go = (delta: number) => {
    const next = years[idx + delta];
    if (next != null) onChange(next);
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous year"
        onClick={() => go(-1)}
        disabled={idx <= 0}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs text-ink-2 hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ◀
      </button>
      <label className="sr-only" htmlFor="bs-year">Year</label>
      <select
        id="bs-year"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs font-medium text-ink tabular-nums focus-visible:outline focus-visible:outline-accent"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Next year"
        onClick={() => go(1)}
        disabled={idx >= years.length - 1}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs text-ink-2 hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ▶
      </button>
    </div>
  );
}
