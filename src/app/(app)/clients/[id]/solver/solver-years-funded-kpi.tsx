"use client";

interface Props {
  value: number | null;
  delta?: number | null;
  dimmed?: boolean;
}

export function SolverYearsFundedKpi({ value, delta, dimmed }: Props) {
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        Years Fully Funded
      </div>
      <div className="mt-1 text-[18px] font-semibold leading-none tabular tracking-tight text-ink">
        {value ?? "—"}
      </div>
      {delta != null && Math.abs(delta) >= 1 ? (
        <div
          className={`mt-1 text-[11px] tabular ${
            delta > 0 ? "text-good" : "text-crit"
          }`}
        >
          {delta > 0 ? `+${delta}` : delta} yrs vs Base
        </div>
      ) : null}
    </div>
  );
}
