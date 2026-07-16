"use client";

interface Props {
  hasMutations: boolean;
  /** Whether any working mutation is persistable to base facts. Technique
   *  upserts (roth / asset-transaction / reinvestment) aren't base-writable, so
   *  gating on this prevents a save that silently writes nothing. */
  canSaveToBase: boolean;
  /** True when the solver source is an existing scenario (not base). Surfaces
   *  the "Update scenario" button and relabels the new-scenario action. */
  canUpdateScenario?: boolean;
  /** Name of the scenario being edited, for the Update button's tooltip. */
  scenarioName?: string | null;
  solveActive?: boolean;
  savingToBase?: boolean;
  updating?: boolean;
  /** When false (view-only shared recipient), hides Save to base facts +
   *  Save as scenario…. Defaults to true so all own-firm callers are unaffected. */
  canEdit?: boolean;
  onReset(): void;
  onSave(): void;
  onSaveToBase(): void;
  onUpdateScenario?(): void;
}

export function SolverActionBar({
  hasMutations,
  canSaveToBase,
  canUpdateScenario,
  scenarioName,
  solveActive,
  savingToBase,
  updating,
  canEdit = true,
  onReset,
  onSave,
  onSaveToBase,
  onUpdateScenario,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hair py-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={solveActive || !hasMutations}
          className="h-9 px-3 text-[13px] font-medium rounded-md border border-hair-2 text-ink-2 bg-card hover:bg-card-hover hover:text-ink hover:border-hair-2 disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Reset
        </button>
      </div>
      <div className="flex items-center gap-2">
        {canEdit && (
          <button
            type="button"
            onClick={onSaveToBase}
            disabled={solveActive || savingToBase || !canSaveToBase}
            title={
              hasMutations && !canSaveToBase
                ? "Roth conversions, asset sales, and reinvestments can't be saved to base facts — save as a scenario instead"
                : undefined
            }
            className="h-9 px-3 text-[13px] font-medium rounded-md border border-hair-2 text-ink-2 bg-card hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 inline-flex items-center gap-2"
          >
            {savingToBase ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border-2 border-ink-3 border-t-transparent animate-spin"
                />
                Saving…
              </>
            ) : (
              "Save to base facts"
            )}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onSave}
            disabled={solveActive || updating || !hasMutations}
            className={
              canUpdateScenario
                ? "h-9 px-3 text-[13px] font-medium rounded-md border border-hair-2 text-ink-2 bg-card hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                : "h-9 px-4 text-[13px] font-semibold rounded-md bg-accent text-accent-on hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            }
          >
            {canUpdateScenario ? "Save as new…" : "Save as scenario…"}
          </button>
        )}
        {canEdit && canUpdateScenario && (
          <button
            type="button"
            onClick={onUpdateScenario}
            disabled={solveActive || updating || !hasMutations}
            title={
              scenarioName
                ? `Save these changes into "${scenarioName}"`
                : "Save these changes into the current scenario"
            }
            className="h-9 px-4 text-[13px] font-semibold rounded-md bg-accent text-accent-on hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper inline-flex items-center gap-2"
          >
            {updating ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border-2 border-accent-on/60 border-t-transparent animate-spin"
                />
                Saving…
              </>
            ) : (
              "Update scenario"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
