"use client";

import { useState } from "react";
import { clampToViewport } from "./clamp-to-viewport";

interface Props {
  anchor: { clientX: number; clientY: number };
  minYear: number;
  maxYear: number;
  defaultYear: number;
  onConfirm: (year: number) => void;
  onCancel: () => void;
}

export function YearPickerPopover({ anchor, minYear, maxYear, defaultYear, onConfirm, onCancel }: Props) {
  const [year, setYear] = useState(defaultYear);
  const ok = year >= minYear && year <= maxYear;
  const { left, top } = clampToViewport(anchor, 260, 140);
  return (
    <div role="dialog" aria-label="Pick gift year" className="fixed inset-0 z-50">
      <button aria-label="Cancel" onClick={onCancel} className="absolute inset-0 cursor-default bg-transparent" />
      <div style={{ left, top }} className="absolute w-[240px] rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] p-3 shadow-xl">
        <label className="block text-xs text-[var(--color-ink-3)]">
          Gift year
          <input
            type="number"
            min={minYear}
            max={maxYear}
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || minYear)}
            className="mt-1 w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card-2)] px-2 py-1 text-sm text-[var(--color-ink)]"
          />
        </label>
        <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
          Between {minYear} and {maxYear}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-[var(--color-hair-2)] px-3 py-1 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-card-hover)]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onConfirm(year)}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-paper)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pick
          </button>
        </div>
      </div>
    </div>
  );
}
