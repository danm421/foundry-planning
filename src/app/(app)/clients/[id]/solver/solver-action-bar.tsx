"use client";

interface Props {
  hasMutations: boolean;
  mcRunning: boolean;
  solveActive?: boolean;
  onReset(): void;
  onGenerateMc(): void;
  onSave(): void;
}

export function SolverActionBar({
  hasMutations,
  mcRunning,
  solveActive,
  onReset,
  onGenerateMc,
  onSave,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hair pt-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={solveActive || !hasMutations}
          className="h-9 px-3 text-[13px] font-medium rounded-md border border-hair-2 text-ink-2 bg-card hover:bg-card-hover hover:text-ink hover:border-hair-2 disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onGenerateMc}
          disabled={solveActive || mcRunning}
          className="h-9 px-3 text-[13px] font-medium rounded-md border border-hair-2 text-ink-2 bg-card hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 inline-flex items-center gap-2"
        >
          {mcRunning ? (
            <>
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full border-2 border-ink-3 border-t-transparent animate-spin"
              />
              Generating…
            </>
          ) : (
            "Generate Monte Carlo"
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={solveActive || !hasMutations}
        className="h-9 px-4 text-[13px] font-semibold rounded-md bg-accent text-accent-on hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        Save as scenario…
      </button>
    </div>
  );
}
