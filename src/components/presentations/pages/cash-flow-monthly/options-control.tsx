"use client";

import type { MonthlyCashFlowPageOptions } from "@/lib/presentations/pages/cash-flow-monthly/types";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { YearRangeControl } from "@/components/presentations/shared/year-range-control";
import { useAgePeople } from "@/components/presentations/options-context";
import YearOrAgeInput from "@/components/year-or-age-input";

interface Props {
  value: MonthlyCashFlowPageOptions;
  onChange: (next: MonthlyCashFlowPageOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function MonthlyCashFlowOptionsControl({ value, onChange }: Props) {
  const people = useAgePeople();
  return (
    <OptionsRow>
      <OptionsGroup label="Show">
        <select
          aria-label="Show"
          className={field}
          value={value.view}
          onChange={(e) =>
            onChange({ ...value, view: e.target.value as MonthlyCashFlowPageOptions["view"] })
          }
        >
          <option value="plan">Across the plan</option>
          <option value="months">Month by month</option>
        </select>
      </OptionsGroup>

      <OptionsGroup label="Dollars">
        <select
          aria-label="Dollars"
          className={field}
          value={value.basis}
          onChange={(e) =>
            onChange({ ...value, basis: e.target.value as MonthlyCashFlowPageOptions["basis"] })
          }
        >
          <option value="today">Today&apos;s dollars</option>
          <option value="nominal">Future dollars</option>
        </select>
      </OptionsGroup>

      {/* The two views take different scoping controls, and showing both at once
          would offer a range the month table ignores. */}
      {value.view === "months" ? (
        <OptionsGroup label="Year">
          <div className="flex items-center gap-2">
            {/* Empty means "let the plan decide" — the same rule the solver
                screen opens on — not year zero. */}
            <YearOrAgeInput
              aria-label="Year"
              year={value.year ?? null}
              onChange={(year) => onChange({ ...value, year })}
              people={people}
              emptyLabel="First shortfall year"
              inputClassName={field}
            />
          </div>
        </OptionsGroup>
      ) : (
        <YearRangeControl value={value.range} onChange={(range) => onChange({ ...value, range })} />
      )}
    </OptionsRow>
  );
}
