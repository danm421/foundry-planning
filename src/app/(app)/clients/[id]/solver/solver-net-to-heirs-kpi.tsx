"use client";

import { formatCurrency } from "./solver-ending-assets-kpi";

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
      <div className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-ink-3">
        Net to Heirs
      </div>
      <div className="mt-0.5 text-[16px] font-semibold leading-none tabular tracking-tight text-ink">
        {value == null ? (loading ? "…" : "—") : formatCurrency(value)}
      </div>
      {value != null && delta != null && Math.abs(delta) >= 1 ? (
        <div
          className={`mt-1 text-[11px] tabular ${
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
