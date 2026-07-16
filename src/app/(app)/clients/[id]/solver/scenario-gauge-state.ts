export type ScenarioGaugeDisplayState =
  | "idle"
  | "computing"
  | "ready"
  | "stale"
  | "error";

interface Input {
  /** Status of the cached Monte Carlo run (useSolverMc). */
  mcStatus: "idle" | "loading" | "ready" | "error";
  /** Working-plan success rate from the latest MC result, if any. */
  mcWorkingSuccess: number | null;
  /** Canonical PoS from the most recent converged solve, cleared on any edit. */
  solvedPoS: number | null;
  /** Monotonic count of edits since mount. */
  editNonce: number;
  /** The editNonce captured when the current/last working-MC run launched. */
  mcEditNonce: number | null;
}

/**
 * Derive the Scenario (right-column) PoS gauge's display state.
 *
 * The gauge is "stale" — and auto-runs a fresh Monte Carlo (see auto-run-mc.ts)
 * — when the user has edited inputs since the last working-MC run
 * (`editNonce !== mcEditNonce`) and there is no fresh solve result covering the
 * current tree. A loading run is "computing"; a fresh `solvedPoS` (cleared on
 * every edit, so always current) is authoritative "ready".
 */
export function deriveScenarioGaugeState(input: Input): {
  state: ScenarioGaugeDisplayState;
  successPct: number | null;
} {
  const { mcStatus, mcWorkingSuccess, solvedPoS, editNonce, mcEditNonce } = input;
  if (mcStatus === "loading") return { state: "computing", successPct: null };
  if (solvedPoS !== null) return { state: "ready", successPct: solvedPoS };
  if (mcStatus === "error") return { state: "error", successPct: null };
  if (mcStatus !== "ready" || mcEditNonce === null) {
    return { state: "idle", successPct: null };
  }
  if (mcEditNonce === editNonce) return { state: "ready", successPct: mcWorkingSuccess };
  return { state: "stale", successPct: mcWorkingSuccess };
}
