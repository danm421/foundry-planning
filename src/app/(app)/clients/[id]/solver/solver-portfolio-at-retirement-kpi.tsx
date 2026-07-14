"use client";

import { formatCurrency } from "./solver-ending-assets-kpi";

interface Props {
  value: number | null;
  delta?: number | null;
  dimmed?: boolean;
}

/** Liquid portfolio at the primary client's retirement year. Sibling of the
 *  Ending Portfolio Assets KPI; the strip only mounts it when applicable. */
export function SolverPortfolioAtRetirementKpi({ value, delta, dimmed }: Props) {
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-ink-3">
        Portfolio at Retirement
      </div>
      <div className="mt-0.5 text-[16px] font-semibold leading-none tabular tracking-tight text-ink">
        {value == null ? "—" : formatCurrency(value)}
      </div>
      {delta != null && Math.abs(delta) >= 1 ? (
        <div
          className={`mt-1 text-[11px] tabular ${
            delta > 0 ? "text-good" : "text-crit"
          }`}
        >
          {delta > 0 ? "+" : "−"}
          {formatCurrency(Math.abs(delta))} vs Base
        </div>
      ) : null}
    </div>
  );
}
