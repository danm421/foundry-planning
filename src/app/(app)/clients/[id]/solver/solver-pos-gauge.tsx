"use client";

import { FanMark } from "@/components/fan-mark";

interface Props {
  state: "idle" | "computing" | "ready" | "stale" | "error";
  successPct: number | null;
  /** When provided (Scenario column only), an error gauge renders a
   *  centered Recalculate overlay that calls this. Omitted on the Base column. */
  onRegenerate?: () => void;
  /** Disables the overlay button while a deterministic solve owns the run. */
  solveActive?: boolean;
  /** When provided, renders a small "↑ from X%" sub-hint below the percentage
   *  whenever the gauge is showing a value and it differs from the baseline. */
  baselineSuccessPct?: number | null;
}

export function SolverPosGauge({ state, successPct, onRegenerate, solveActive, baselineSuccessPct }: Props) {
  let display: string;
  if (state === "ready" || state === "stale") {
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

  // The overlay is a retry affordance only. A stale gauge re-runs on its own
  // (see auto-run-mc.ts), so a button there would race the pending auto-run.
  const showOverlay = onRegenerate != null && state === "error";
  // `stale` keeps the prior value dimmed through the auto-run debounce — the
  // dim is deliberately NOT tied to the overlay, which stale no longer shows.
  const contentDim = showOverlay
    ? "opacity-40 pointer-events-none"
    : state === "stale"
      ? "opacity-40"
      : state === "idle"
        ? "opacity-70"
        : "";

  return (
    <div className="relative">
      <div className={contentDim}>
        <div className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-ink-3">
          Probability of Success
        </div>
        <div
          className={`mt-0.5 flex h-5 items-center text-[20px] font-semibold leading-none tabular tracking-tight ${valueTone}`}
        >
          {state === "computing" ? (
            <span role="status" aria-label="Calculating probability of success">
              {/* Bare mark — no room for MarkLoader's halo at 20px — so the
                  strokes carry the motion themselves; a run can last a minute. */}
              <FanMark className="h-5 w-7 text-accent" strokeWidth={3} loop />
            </span>
          ) : (
            display
          )}
        </div>
        {(state === "ready" || state === "stale") && successPct != null && baselineSuccessPct != null && baselineSuccessPct !== successPct ? (
          <div className="text-[10px] text-ink-4">
            {successPct > baselineSuccessPct ? "↑" : "↓"} from {Math.round(baselineSuccessPct * 100)}%
          </div>
        ) : null}
      </div>
      {showOverlay ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={solveActive}
            aria-label="Recalculate probability of success"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span aria-hidden="true" className="text-[12px] leading-none">
              ↻
            </span>
            Recalculate
          </button>
        </div>
      ) : null}
    </div>
  );
}
