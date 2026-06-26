"use client";

// Life Insurance solver — inputs (left pane) + results (right pane).
//
// The debounced solve + autosave loop lives in `useLiNeedSolve`: while the LI
// surface is active, editing an input updates `assumptions`; after a ~600ms
// debounce a solve request fires (POST .../life-insurance/solve) and the
// assumptions are persisted (PUT .../life-insurance/settings). Stale in-flight
// solves are discarded via a request-sequence guard so a slow earlier solve
// never overwrites a newer result.
//
// `SolverLifeInsuranceInputs` (left) renders the assumptions panel that drives
// the loop; `SolverLifeInsuranceResults` (right) renders the solved need range
// (straight-line lower bound → Monte Carlo upper bound). The workspace owns the
// lifted `assumptions` state and calls `useLiNeedSolve` once so both halves read
// the same result.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectionYear } from "@/engine/types";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { LiAssumptionsPanel } from "./li-assumptions-panel";
import { LiNeedRange } from "./li-need-range";
import { useClientAccess } from "@/components/client-access-provider";

/** One decedent's solved need + the survivor's projection. */
export interface LiSolveCase {
  status: string;
  faceValue: number;
  achievedEndingPortfolio: number;
  projection: ProjectionYear[];
  /** In-force policies on the decedent active in the death year (not rounded). */
  existingPolicies: { name: string; faceValue: number }[];
  /** Sum of `existingPolicies` face values (not rounded). */
  existingCoverageTotal: number;
  /** Federal + state estate tax + IRD added to the solve target when the
   *  "Cover estate taxes" toggle is on; `0` when the toggle is off. */
  estateTaxAddend: number;
}

/** Shape of the POST .../life-insurance/solve response. */
export interface LiSolveResult {
  isMarried: boolean;
  client: LiSolveCase;
  spouse: LiSolveCase | null;
}

const DEBOUNCE_MS = 600;

/**
 * Owns the straight-line solve + settings autosave for the Life Insurance
 * surface. The workspace calls this ONCE and feeds the result to the right-pane
 * results view; the left-pane inputs view drives `assumptions`.
 *
 * `enabled` gates ALL work: while false, no `/solve` or `/settings` fetch ever
 * fires. On each false→true transition (e.g. re-opening the LI surface) the hook
 * runs one initial solve with the current assumptions; while enabled, it
 * debounces a solve + autosave on every `assumptions` change. The enable-edge
 * solve and the debounce never double-fire on the same edge.
 */
export function useLiNeedSolve(
  clientId: string,
  assumptions: LiAssumptions,
  enabled: boolean,
): {
  solveResult: LiSolveResult | null;
  isSolving: boolean;
  errorMessage: string | null;
} {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";

  const [solveResult, setSolveResult] = useState<LiSolveResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Monotonic counter — only the latest solve's result is allowed to land.
  const solveSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSolveAndSave = useCallback(
    async (a: LiAssumptions) => {
      const seq = ++solveSeqRef.current;
      setIsSolving(true);
      const body = JSON.stringify(a);
      try {
        // Persist only when the user has edit permission (fire-and-forget;
        // surface failures but don't block the solve).
        const savePromise = canEdit
          ? fetch(
              `/api/clients/${clientId}/life-insurance/settings`,
              { method: "PUT", headers: { "content-type": "application/json" }, body },
            )
          : null;

        const res = await fetch(
          `/api/clients/${clientId}/life-insurance/solve`,
          { method: "POST", headers: { "content-type": "application/json" }, body },
        );
        if (!res.ok) throw new Error(`Solve failed (HTTP ${res.status})`);
        const data: LiSolveResult = await res.json();

        // Discard if a newer change has already superseded this request.
        if (seq !== solveSeqRef.current) return;
        setSolveResult(data);
        setErrorMessage(null);

        if (savePromise) {
          const saveRes = await savePromise;
          if (seq === solveSeqRef.current && !saveRes.ok) {
            setErrorMessage(`Could not save assumptions (HTTP ${saveRes.status})`);
          }
        }
      } catch (err) {
        if (seq !== solveSeqRef.current) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === solveSeqRef.current) setIsSolving(false);
      }
    },
    [clientId, canEdit],
  );

  // Mirrors the latest `assumptions` prop so the enable-edge solve reads the
  // current value without re-running when only the assumptions change.
  const assumptionsRef = useRef(assumptions);
  assumptionsRef.current = assumptions;

  // Initial solve on each false→true edge — show results immediately whenever
  // the LI surface becomes active (replaces the old mount-solve; re-opening LI
  // re-solves). `wasEnabled` tracks the prior value so we only act on the edge.
  const wasEnabledRef = useRef(false);
  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      wasEnabledRef.current = true;
      void runSolveAndSave(assumptionsRef.current);
    } else if (!enabled) {
      wasEnabledRef.current = false;
    }
    // `assumptions` is intentionally not a dep — the edge solve reads the latest
    // value via `assumptionsRef`; assumptions edits ride the debounce effect.
  }, [enabled, runSolveAndSave]);

  // Debounced solve + autosave on any assumptions edit while enabled. Skips the
  // run that coincides with the enable edge (the effect above already solved
  // that one) so the edge never double-fires.
  const skipNextDebounceRef = useRef(true);
  useEffect(() => {
    if (!enabled) {
      // Inactive: no solving, and re-arm the skip so the next enable edge's
      // assumptions change doesn't fire a redundant debounce on top of the
      // edge solve.
      skipNextDebounceRef.current = true;
      return;
    }
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return; // the enable-edge effect already solved with these assumptions
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSolveAndSave(assumptions);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [assumptions, enabled, runSolveAndSave]);

  return { solveResult, isSolving, errorMessage };
}

/**
 * Left-pane LI inputs: the "Life Insurance Need" heading + the assumptions
 * panel. No solve loop, no MC control, no result cards — those live in the
 * right pane (see `SolverLifeInsuranceResults`).
 */
export function SolverLifeInsuranceInputs({
  assumptions,
  onAssumptionsChange,
  liabilities,
  estateAdminExpenses,
  modelPortfolios,
}: {
  /** Current LI assumptions — owned by LiveSolverWorkspace. */
  assumptions: LiAssumptions;
  /** Update the lifted assumptions (drives the debounced solve + autosave). */
  onAssumptionsChange: (next: LiAssumptions) => void;
  /** Household liabilities for the per-liability payoff picker. */
  liabilities: { id: string; name: string; balance: number }[];
  /** Estate settlement cost from Details > Assumptions (read-only display). */
  estateAdminExpenses: number;
  /** Firm model portfolios for the LI-proceeds growth picker. */
  modelPortfolios: { id: string; name: string }[];
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
      <h2 className="text-[15px] font-medium text-ink">Life Insurance Need</h2>
      <LiAssumptionsPanel
        assumptions={assumptions}
        onChange={onAssumptionsChange}
        liabilities={liabilities}
        estateAdminExpenses={estateAdminExpenses}
        modelPortfolios={modelPortfolios}
      />
    </div>
  );
}

/**
 * Right-pane LI results: the "Solving…" indicator, the straight-line error (if
 * any), and the need-range cards — which bundle the Monte Carlo control strip.
 * `solveResult` comes from `useLiNeedSolve` in the workspace.
 */
export function SolverLifeInsuranceResults({
  clientId,
  assumptions,
  solveResult,
  isSolving,
  errorMessage,
  clientName,
  spouseName,
  onScoreChange,
}: {
  clientId: string;
  /** Full current assumptions — POSTed verbatim as the solve-mc body. */
  assumptions: LiAssumptions;
  /** Straight-line solve from `useLiNeedSolve`; null until the first solve lands. */
  solveResult: LiSolveResult | null;
  isSolving: boolean;
  errorMessage: string | null;
  /** Display name for the client; falls back to "Client" upstream when unknown. */
  clientName: string;
  /** Display name for the spouse; falls back to "Spouse" upstream when unknown. */
  spouseName: string;
  /** Lift the updated `mcTargetScore` (decimal 0–1) to the workspace. */
  onScoreChange: (score: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-medium text-ink">Life Insurance Need</h2>
        {isSolving ? (
          <span className="text-[11px] text-ink-3" aria-live="polite">
            Solving…
          </span>
        ) : null}
      </div>

      {solveResult ? (
        <div className={isSolving ? "opacity-60 transition-opacity" : ""}>
          <LiNeedRange
            clientId={clientId}
            solveResult={solveResult}
            assumptions={assumptions}
            clientName={clientName}
            spouseName={spouseName}
            onScoreChange={onScoreChange}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-hair bg-card p-6 text-center text-[12px] text-ink-3">
          {isSolving ? "Solving life insurance need…" : "No solve results yet."}
        </div>
      )}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
