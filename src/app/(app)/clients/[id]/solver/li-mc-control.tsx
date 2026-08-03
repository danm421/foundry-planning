"use client";

// Life Insurance solver — Monte Carlo control (left input pane).
//
// The trigger half of the MC need solve: the advisor sets a target success
// score and runs the solve from here, beside the assumptions that feed it. The
// solved upper bound lands in the right pane's need cards (`LiNeedRange`).
// State lives in `useLiMcSolve`, owned by the workspace so the two panes share
// one run.
import { useState } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { LiMcSolve, McProgressPayload } from "./use-li-mc-solve";

export function LiMcControl({
  targetScore,
  onScoreChange,
  mc,
  clientName,
  spouseName,
}: {
  /** Current `mcTargetScore` (decimal 0–1). */
  targetScore: number;
  /** Lift the updated `mcTargetScore` (decimal 0–1) to the workspace. */
  onScoreChange: (score: number) => void;
  mc: LiMcSolve;
  /** Display names for the progress bar's per-decedent pass. */
  clientName: string;
  spouseName: string;
}) {
  const targetPct = Math.round(targetScore * 1000) / 10;

  return (
    <div className="rounded-lg border border-hair bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            className="flex items-center gap-1.5 text-[11px] text-ink-3"
            htmlFor="li-mc-target-score"
          >
            Monte Carlo target success
            <FieldTooltip text="Straight-line sets the lower bound of the need range; Monte Carlo the upper bound. The solve finds the coverage that hits this score across many randomized market trials." />
          </label>
          <div className="relative mt-1">
            <TargetScoreInput
              id="li-mc-target-score"
              targetPct={targetPct}
              disabled={mc.isSolving}
              onCommit={onScoreChange}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
              %
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void mc.solve()}
          disabled={mc.isSolving}
          className="h-9 shrink-0 rounded-md bg-accent px-3.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Solve for score
        </button>
        {mc.isSolving ? (
          <button
            type="button"
            onClick={mc.cancel}
            className="h-9 shrink-0 rounded-md border border-hair-2 px-3 text-[12px] text-ink-2 hover:bg-card-2"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {mc.isSolving ? (
        <div className="mt-2.5">
          <McProgressBar
            progress={mc.progress}
            clientName={clientName}
            spouseName={spouseName}
          />
        </div>
      ) : null}

      {mc.errorMessage ? (
        <div
          role="alert"
          className="mt-2.5 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {mc.errorMessage}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Progress bar. The route reports `done/total` per decedent case in turn
 * (client, then spouse). For a married plan that's two sequential passes — we
 * combine them into one 0–100% bar: the client case occupies the first half,
 * the spouse case the second half. For a single plan only the client case
 * fires, so its fraction maps straight to 0–100%.
 */
function McProgressBar({
  progress,
  clientName,
  spouseName,
}: {
  progress: McProgressPayload | null;
  clientName: string;
  spouseName: string;
}) {
  let pct = 0;
  let label = "Starting Monte Carlo solve…";
  if (progress && progress.total > 0) {
    const frac = Math.min(1, progress.done / progress.total);
    if (progress.case === "client") {
      // First half of the bar when a spouse pass may follow; harmless if not.
      pct = frac * 50;
      label = `Solving ${clientName} death…`;
    } else {
      pct = 50 + frac * 50;
      label = `Solving ${spouseName} death…`;
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <span className="text-[11px] tabular text-ink-3">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-hair-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Percent input — the advisor types a whole/decimal percent (`90`, `92.5`) and
 * the value is committed as the decimal `mcTargetScore` (`0.90`). The schema
 * bounds it to 0.01–0.99.
 */
function TargetScoreInput({
  id,
  targetPct,
  disabled,
  onCommit,
}: {
  id: string;
  targetPct: number;
  disabled?: boolean;
  onCommit: (decimal: number) => void;
}) {
  const [display, setDisplay] = useState<string>(String(targetPct));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d.]/g, "");
    setDisplay(raw);
    if (raw === "" || raw === ".") return;
    const pct = Number(raw);
    if (Number.isNaN(pct)) return;
    const next = pct / 100;
    if (next < 0.01 || next > 0.99) return;
    onCommit(next);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      disabled={disabled}
      className="h-9 w-24 rounded-md border border-hair-2 bg-card-2 pl-2.5 pr-6 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Target Plan Confidence"
    />
  );
}
