// src/components/presentations/shared/year-range-control.tsx
"use client";

import type { NamedRange, RangeOption } from "@/lib/presentations/shared/year-filter";
import { summarizeRange } from "@/lib/presentations/shared/drill-options";
import { OptionsGroup, optionsFieldClassName } from "./options-layout";
import { useAgePeople } from "@/components/presentations/options-context";
import YearOrAgeInput from "@/components/year-or-age-input";

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
  const people = useAgePeople();
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
        <div className="flex flex-col gap-1.5 pl-6 pt-1">
          <label className="flex items-center gap-2">
            <span className="w-9 text-[11px] uppercase tracking-[0.1em] text-ink-3">From</span>
            <YearOrAgeInput
              aria-label="Start year"
              year={startYear}
              onChange={(y) => y != null && onChange({ startYear: y, endYear })}
              people={people}
              inputClassName={optionsFieldClassName}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-9 text-[11px] uppercase tracking-[0.1em] text-ink-3">To</span>
            <YearOrAgeInput
              aria-label="End year"
              year={endYear}
              onChange={(y) => y != null && onChange({ startYear, endYear: y })}
              people={people}
              inputClassName={optionsFieldClassName}
            />
          </label>
        </div>
      )}
    </OptionsGroup>
  );
}
