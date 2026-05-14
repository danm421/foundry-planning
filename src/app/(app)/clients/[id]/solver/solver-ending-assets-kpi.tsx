"use client";

interface Props {
  value: number | null;
  delta?: number | null;
  dimmed?: boolean;
}

export function SolverEndingAssetsKpi({ value, delta, dimmed }: Props) {
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        Ending Portfolio Assets
      </div>
      <div className="mt-1 text-[18px] font-semibold leading-none tabular tracking-tight text-ink">
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

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  return `$${Math.round(n).toLocaleString()}`;
}
