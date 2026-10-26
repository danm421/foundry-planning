"use client";

import type { ReactNode } from "react";

/** One entry in a growth-source dropdown. `pct` (0–100) is the yearly rate the
 *  source resolves to, or null when it has none of its own (a custom rate). */
export interface GrowthChoice {
  value: string;
  name: string;
  pct: number | null;
}

/**
 * A growth-source dropdown that shows its result, not just its choice: the
 * yearly rate the selected source resolves to, large and tabular, beside the
 * source's name. The native <select> sits invisibly over that face, so the
 * open list, keyboard handling and accessible name stay the browser's own.
 *
 * `customInput` (the caller's % box) renders to the left while "custom" is
 * picked, where the readout would otherwise be.
 */
export function GrowthSourceSelect({
  id,
  value,
  options,
  onChange,
  customInput,
}: {
  id?: string;
  value: string;
  options: GrowthChoice[];
  onChange: (raw: string) => void;
  customInput?: ReactNode;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div className="flex gap-2">
      {value === "custom" && customInput && <div className="w-28 shrink-0">{customInput}</div>}
      <div className="relative flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 pl-3 pr-8 select-chevron hover:border-hair-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        {selected?.pct != null && (
          <span className="tabular shrink-0 text-[15px] leading-none text-ink">
            {selected.pct.toFixed(2)}%
          </span>
        )}
        <span className="min-w-0 truncate text-[13px] text-ink-2">{selected?.name}</span>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.pct !== null ? `${o.pct.toFixed(2)}% — ${o.name}` : o.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
