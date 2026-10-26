"use client";

import type { SolverCashFlowOptions } from "@/lib/presentations/pages/solver-cash-flow/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { useAgePeople } from "@/components/presentations/options-context";
import YearOrAgeInput from "@/components/year-or-age-input";

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function SolverCashFlowOptionsControl({
  value,
  onChange,
}: {
  value: SolverCashFlowOptions;
  onChange: (next: SolverCashFlowOptions) => void;
}) {
  const people = useAgePeople();
  return (
    <OptionsRow>
      <OptionsGroup label="Year">
        <div className="flex items-center gap-2">
          {/* Empty means the first plan year, not year zero. */}
          <YearOrAgeInput
            aria-label="Year"
            year={value.year ?? null}
            onChange={(year) => onChange({ year })}
            people={people}
            emptyLabel="First plan year"
            inputClassName={field}
          />
        </div>
      </OptionsGroup>
    </OptionsRow>
  );
}
