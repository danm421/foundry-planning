"use client";

interface Props {
  state: "idle" | "computing" | "ready" | "stale" | "error";
  successPct: number | null;
}

export function SolverPosGauge({ state, successPct }: Props) {
  let display: string;
  if (state === "computing") display = "…";
  else if (state === "ready" || state === "stale") {
    display = successPct == null ? "—" : `${Math.round(successPct * 100)}%`;
  } else if (state === "error") display = "Error";
  else display = "—";

  const pct = state === "ready" || state === "stale" ? successPct : null;
  const valueTone =
    pct == null
      ? "text-ink-3"
      : pct >= 0.85
        ? "text-good"
        : pct >= 0.7
          ? "text-warn"
          : "text-crit";

  const dimmed = state === "stale" || state === "idle";
  return (
    <div className={dimmed ? "opacity-70" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        Probability of Success
      </div>
      <div className={`mt-1 text-[28px] font-semibold leading-none tabular tracking-tight ${valueTone}`}>
        {display}
      </div>
      {state === "stale" ? (
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-warn">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
          Stale — re-generate
        </div>
      ) : null}
    </div>
  );
}
