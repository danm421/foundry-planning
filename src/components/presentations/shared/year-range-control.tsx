// src/components/presentations/shared/year-range-control.tsx
"use client";

import type { NamedRange, RangeOption } from "@/lib/presentations/shared/year-filter";
import { summarizeRange } from "@/lib/presentations/shared/drill-options";
import { OptionsGroup } from "./options-layout";

const CURRENT_YEAR = new Date().getFullYear();

interface Props {
  value: RangeOption;
  onChange: (next: RangeOption) => void;
  /** Named ranges to offer between Full and Custom. The control does not know
   *  what any of them means; the page that offers one does. */
  presets?: NamedRange[];
}

/** Full / Custom year-range picker shared by the cash-flow page and every
 *  cash-flow / estate drill. Renders as a single labeled options group. */
export function YearRangeControl({ value, onChange, presets }: Props) {
  const isCustom = typeof value === "object";
  const startYear = isCustom ? value.startYear : CURRENT_YEAR;
  const endYear = isCustom ? value.endYear : CURRENT_YEAR + 30;

  return (
    <OptionsGroup label="Years">
      <label className="flex items-center gap-2 hover:text-ink">
        <input
          type="radio"
          aria-label="Full"
          className="accent-accent"
          checked={value === "full"}
          onChange={() => onChange("full")}
        />
        <span>Full range</span>
      </label>
      {presets?.map((preset) => (
        <label key={preset} className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            aria-label={summarizeRange(preset)}
            className="accent-accent"
            checked={value === preset}
            onChange={() => onChange(preset)}
          />
          <span>{summarizeRange(preset)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2 hover:text-ink">
        <input
          type="radio"
          aria-label="Custom"
          className="accent-accent"
          checked={isCustom}
          onChange={() => onChange({ startYear, endYear })}
        />
        <span>Custom range</span>
      </label>
      {isCustom && (
        <div className="flex items-center gap-3 pl-6 pt-1">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Start year</span>
            <input
              type="number"
              aria-label="Start year"
              className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={startYear}
              onChange={(e) => onChange({ startYear: Number(e.target.value), endYear })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">End year</span>
            <input
              type="number"
              aria-label="End year"
              className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={endYear}
              onChange={(e) => onChange({ startYear, endYear: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </OptionsGroup>
  );
}
