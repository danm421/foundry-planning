import type { ScenarioGaugeDisplayState } from "./scenario-gauge-state";

/**
 * How long the solver waits after an edit before launching a Monte Carlo run.
 *
 * Eager by design: a 1000-trial run measures 4-13s median (40-75s tail), so on
 * a typical plan the number lands quickly enough to feel live. Superseded runs
 * are not cancellable today — the server finishes them regardless — so this is
 * the only throttle in the system. Do not shorten it without re-reading the
 * Phase 2 notes in the design spec.
 */
export const AUTO_RUN_DEBOUNCE_MS = 2000;

/**
 * Whether an edit should automatically launch a Monte Carlo run.
 *
 * The rule: whatever makes the Recalculate button appear now fires a run
 * instead. `deriveScenarioGaugeState` already computes that condition, so this
 * predicate adds only the two guards it cannot see:
 *
 * - `"stale"` only, never `"error"` — auto-retrying a failing run loops forever.
 * - Never while a deterministic solve is running; the solve owns the CPU.
 *
 * Single-in-flight and queue-the-latest need no logic here: a run in flight
 * reports `"computing"`, not `"stale"`, so this returns false until it lands —
 * and if edits arrived meanwhile the state flips back to `"stale"` and the next
 * run picks up the newest tree.
 */
export function shouldAutoRunMc(input: {
  state: ScenarioGaugeDisplayState;
  solveActive: boolean;
}): boolean {
  return input.state === "stale" && !input.solveActive;
}
