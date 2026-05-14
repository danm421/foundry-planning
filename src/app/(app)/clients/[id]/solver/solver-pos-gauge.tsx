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

  const dimmed = state === "stale" || state === "idle";
  return (
    <div className={dimmed ? "opacity-60" : ""}>
      <div className="text-xs uppercase tracking-wide text-gray-500">
        Probability of Success
      </div>
      <div className="text-3xl font-semibold tabular-nums">{display}</div>
      {state === "stale" ? (
        <div className="text-xs text-amber-600 mt-1">Stale — re-generate</div>
      ) : null}
    </div>
  );
}
