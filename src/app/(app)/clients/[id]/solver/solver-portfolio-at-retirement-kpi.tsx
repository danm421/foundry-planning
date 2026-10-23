"use client";

import { formatCurrency, KPI_DELTA, KPI_LABEL, KPI_VALUE } from "./solver-ending-assets-kpi";

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
      <div className={KPI_LABEL}>
        Portfolio at Retirement
      </div>
      <div className={`${KPI_VALUE} text-ink`}>
        {value == null ? "—" : formatCurrency(value)}
      </div>
      {delta != null && Math.abs(delta) >= 1 ? (
        <div
          className={`${KPI_DELTA} ${
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
