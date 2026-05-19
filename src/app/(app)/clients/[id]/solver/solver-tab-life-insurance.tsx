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
// The <pre> debug dump below is intentional scaffolding — Task 11 replaces
// it with real need-result cards + a survivor projection chart, reading
// `solveResult.isMarried`, `solveResult.client`, `solveResult.spouse`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { LiAssumptionsPanel } from "./li-assumptions-panel";

/** One decedent's solved need + the survivor's projection (Task 11 reads this). */
export interface LiSolveCase {
  status: string;
  faceValue: number;
  achievedEndingPortfolio: number;
  projection: unknown;
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
}

const DEBOUNCE_MS = 600;

export function SolverTabLifeInsurance({ clientId, settings }: Props) {
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
      <LiAssumptionsPanel assumptions={assumptions} onChange={setAssumptions} />

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* (2) Need result cards — filled in by Task 11. */}

      {/* (3) Need-over-time chart — filled in by Task 11. */}

      {/* Debug dump — confirms the solve wiring; removed by Task 11. */}
      <pre className="overflow-x-auto rounded-md border border-hair-2 bg-card-2 p-3 text-[12px] text-ink-3">
        {JSON.stringify({ clientId, assumptions, solveResult }, null, 2)}
      </pre>
    </div>
  );
}
