// src/app/(app)/clients/[id]/solver/solver-solve-progress-strip.tsx
"use client";

interface Props {
  title: string;
  iteration: number | null;
  maxIterations: number;
  candidateValue: number | null;
  achievedPoS: number | null;
  valueFormatter: (v: number) => string;
  onCancel: () => void;
}

export function SolverSolveProgressStrip({
  title,
  iteration,
  maxIterations,
  candidateValue,
  achievedPoS,
  valueFormatter,
  onCancel,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{title}</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          Cancel
        </button>
      </div>
      <div className="mt-1 text-[11px] text-ink-3 tabular">
        {iteration === null ? (
          <span>Starting…</span>
        ) : (
          <span>
            Iteration {iteration}/{maxIterations}
            {candidateValue !== null ? (
              <>
                {" — trying "}
                <span className="text-ink-2">{valueFormatter(candidateValue)}</span>
              </>
            ) : null}
            {achievedPoS !== null ? (
              <>
                , PoS{" "}
                <span className="text-ink-2">{Math.round(achievedPoS * 1000) / 10}%</span>
              </>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
}
