"use client";

// Shared by every KPI in the strip. Matches the Cash Flow year breakdown's
// summary row; the vs-Base line is sized to read on a shared screen.
export const KPI_LABEL = "whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3";
export const KPI_VALUE = "tabular mt-1 text-[20px] font-semibold leading-6";
export const KPI_DELTA = "tabular mt-1 text-[14px] font-semibold";

interface Props {
  value: number | null;
  delta?: number | null;
  dimmed?: boolean;
}

export function SolverEndingAssetsKpi({ value, delta, dimmed }: Props) {
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className={KPI_LABEL}>
        Ending Portfolio Assets
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

export function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  return `$${Math.round(n).toLocaleString()}`;
}
