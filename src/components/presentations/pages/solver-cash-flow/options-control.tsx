"use client";

import type { SolverCashFlowOptions } from "@/lib/presentations/pages/solver-cash-flow/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function SolverCashFlowOptionsControl({
  value,
  onChange,
}: {
  value: SolverCashFlowOptions;
  onChange: (next: SolverCashFlowOptions) => void;
}) {
  return (
    <OptionsRow>
      <OptionsGroup label="Year">
        <input
          type="number"
          aria-label="Year"
          placeholder="First plan year"
          className={`${field} w-40`}
          value={value.year ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            // Empty means the first plan year, not year zero.
            onChange({ year: raw === "" ? null : Number(raw) });
          }}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
