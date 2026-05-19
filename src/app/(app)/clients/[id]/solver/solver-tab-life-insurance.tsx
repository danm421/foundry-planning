"use client";

// Life Insurance solver tab.
//
// Task 10: renders the assumptions panel and wires the debounced solve +
// autosave loop. Editing an input updates `assumptions`; after a ~600ms
// debounce a solve request fires (POST .../life-insurance/solve) and the
// assumptions are persisted (PUT .../life-insurance/settings). Stale
// in-flight solves are discarded via a request-sequence guard so a slow
// earlier solve never overwrites a newer result.
//
// Task 11: renders the need-result cards + survivor projection chart from
// the solve response. Phases 2–3 slot a Monte Carlo block and an over-time
// section below the chart — keep the layout extensible.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectionYear } from "@/engine/types";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { LiAssumptionsPanel } from "./li-assumptions-panel";
import { LiMcSolve } from "./li-mc-solve";
import { LiNeedCards } from "./li-need-cards";
import { LiOverTimeSection } from "./li-over-time-section";
import { LiSurvivorChart } from "./li-survivor-chart";

/** One decedent's solved need + the survivor's projection (Task 11 reads this). */
export interface LiSolveCase {
  status: string;
  faceValue: number;
  achievedEndingPortfolio: number;
  projection: ProjectionYear[];
  /** In-force policies on the decedent active in the death year (not rounded). */
  existingPolicies: { name: string; faceValue: number }[];
  /** Sum of `existingPolicies` face values (not rounded). */
  existingCoverageTotal: number;
}

/** Shape of the POST .../life-insurance/solve response. */
export interface LiSolveResult {
  isMarried: boolean;
  client: LiSolveCase;
  spouse: LiSolveCase | null;
}

interface Props {
  clientId: string;
  settings: LiAssumptions;
  /** Display name for the client; falls back to "Client" upstream when unknown. */
  clientName: string;
  /** Display name for the spouse; falls back to "Spouse" upstream when unknown. */
  spouseName: string;
  /** Household liabilities for the per-liability payoff picker. */
  liabilities: { id: string; name: string; balance: number }[];
  /** Estate settlement cost from Details > Assumptions (read-only display). */
  estateAdminExpenses: number;
  /** Firm model portfolios for the LI-proceeds growth picker. */
  modelPortfolios: { id: string; name: string }[];
}

const DEBOUNCE_MS = 600;

export function SolverTabLifeInsurance({
  clientId,
  settings,
  clientName,
  spouseName,
  liabilities,
  estateAdminExpenses,
  modelPortfolios,
}: Props) {
  const [assumptions, setAssumptions] = useState<LiAssumptions>(settings);
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
        // Persist (fire-and-forget; surface failures but don't block the solve).
        const savePromise = fetch(
          `/api/clients/${clientId}/life-insurance/settings`,
          { method: "PUT", headers: { "content-type": "application/json" }, body },
        );

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

        const saveRes = await savePromise;
        if (seq === solveSeqRef.current && !saveRes.ok) {
          setErrorMessage(`Could not save assumptions (HTTP ${saveRes.status})`);
        }
      } catch (err) {
        if (seq !== solveSeqRef.current) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === solveSeqRef.current) setIsSolving(false);
      }
    },
    [clientId],
  );

  // Initial solve on mount — show results immediately on first open.
  useEffect(() => {
    void runSolveAndSave(settings);
    // Intentionally only on mount; later solves are debounced via `assumptions`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lift an updated MC target score from the MC block. Changing the score must
  // NOT trigger an MC solve (it's expensive — that runs only on the explicit
  // button click), but it does ride the cheap debounced straight-line solve +
  // settings autosave below, which is how the score gets persisted.
  const handleScoreChange = useCallback((mcTargetScore: number) => {
    setAssumptions((prev) => ({ ...prev, mcTargetScore }));
  }, []);

  // Debounced solve + autosave on any assumptions edit.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return; // mount-effect already solved with the seed assumptions
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSolveAndSave(assumptions);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [assumptions, runSolveAndSave]);

  return (
    <div className="space-y-4 px-3 py-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-medium text-ink">Life Insurance Need</h2>
        {isSolving ? (
          <span className="text-[11px] text-ink-3" aria-live="polite">
            Solving…
          </span>
        ) : null}
      </div>

      {/* (1) Assumptions panel. */}
      <LiAssumptionsPanel
        assumptions={assumptions}
        onChange={setAssumptions}
        liabilities={liabilities}
        estateAdminExpenses={estateAdminExpenses}
        modelPortfolios={modelPortfolios}
      />

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Layout: assumptions → straight-line need cards → Monte Carlo solve
          block → survivor chart. The two solved needs read adjacently, then
          the chart. The over-time section (Phase 3) slots in below the chart. */}
      {solveResult ? (
        <div className={isSolving ? "opacity-60 transition-opacity" : ""}>
          <LiNeedCards
            result={solveResult}
            deathYear={assumptions.deathYear}
            clientName={clientName}
            spouseName={spouseName}
          />
          <div className="mt-4">
            <LiMcSolve
              clientId={clientId}
              assumptions={assumptions}
              clientName={clientName}
              spouseName={spouseName}
              onScoreChange={handleScoreChange}
            />
          </div>
          <div className="mt-4">
            <LiSurvivorChart
              result={solveResult}
              clientName={clientName}
              spouseName={spouseName}
            />
          </div>
          <div className="mt-4">
            <LiOverTimeSection
              clientId={clientId}
              assumptions={assumptions}
              isMarried={solveResult.isMarried}
              clientName={clientName}
              spouseName={spouseName}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-hair bg-card p-6 text-center text-[12px] text-ink-3">
          {isSolving ? "Solving life insurance need…" : "No solve results yet."}
        </div>
      )}
    </div>
  );
}
