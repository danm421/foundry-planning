"use client";

import { formatCurrency, KPI_DELTA, KPI_LABEL, KPI_VALUE } from "./solver-ending-assets-kpi";

interface Props {
  value: number | null;
  delta?: number | null;
  dimmed?: boolean;
  /** True while the estate projection (with death events) is still loading. */
  loading?: boolean;
}

export function SolverNetToHeirsKpi({ value, delta, dimmed, loading }: Props) {
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className={KPI_LABEL}>
        Total to Heirs
      </div>
      <div className={`${KPI_VALUE} text-ink`}>
        {value == null ? (loading ? "…" : "—") : formatCurrency(value)}
      </div>
      {value != null && delta != null && Math.abs(delta) >= 1 ? (
        <div
          className={`${KPI_DELTA} ${
            // More to heirs is good: positive delta = text-good.
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
