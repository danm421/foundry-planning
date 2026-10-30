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
  // A stored descriptor that was never parsed through the schema has no mode.
  const mode = value.mode ?? "cashflow";
  const distributions = mode === "distributions";
  return (
    <OptionsRow>
      <OptionsGroup label="Report">
        <select
          aria-label="Report"
          className={field}
          value={mode}
          onChange={(e) =>
            onChange({ ...value, mode: e.target.value as MonthlyCashFlowPageOptions["mode"] })
          }
        >
          <option value="cashflow">Cash flow</option>
          <option value="distributions">Distributions</option>
        </select>
      </OptionsGroup>

      {/* Distributions is one card plus one table, so it has no view to pick. */}
      {!distributions && (
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
      )}

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

      {/* Cash flow's two views take different scoping controls, and showing both
          would offer a range the month table ignores. */}
      {distributions || value.view === "months" ? (
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
      ) : null}
      {/* Distributions prints a year card AND a range of years in its table. */}
      {distributions || value.view === "plan" ? (
        <YearRangeControl value={value.range} onChange={(range) => onChange({ ...value, range })} />
      ) : null}
    </OptionsRow>
  );
}
