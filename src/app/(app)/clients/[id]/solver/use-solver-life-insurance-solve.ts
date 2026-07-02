// src/app/(app)/clients/[id]/solver/use-solver-life-insurance-solve.ts
"use client";
import { useEffect, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { LiSolved } from "@/lib/presentations/pages/life-insurance-summary/options-schema";

export interface SolverLifeInsuranceSolveState {
  status: "idle" | "loading" | "ready" | "error";
  data: LiSolved | null;
  error?: string;
}

interface Args {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  assumptions: LiAssumptions;
  modelPortfolioLabel: string;
  /** 0 = not run yet; bump to launch a fresh run (Run / Recalculate). */
  nonce: number;
}

/**
 * Run-button-gated Life Insurance summary solve. Mirrors
 * useSolverRetirementComparison: POSTs source + live mutations + assumptions to
 * the working-tree solve route and returns the `LiSolved` payload the summary
 * view consumes. Latest-mutations/assumptions are read via refs so bumping the
 * nonce always solves the current working plan.
 */
export function useSolverLifeInsuranceSolve({
  clientId, source, mutations, assumptions, modelPortfolioLabel, nonce,
}: Args): SolverLifeInsuranceSolveState {
  const [state, setState] = useState<SolverLifeInsuranceSolveState>({ status: "idle", data: null });
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const assumptionsRef = useRef(assumptions);
  assumptionsRef.current = assumptions;
  const labelRef = useRef(modelPortfolioLabel);
  labelRef.current = modelPortfolioLabel;

  useEffect(() => {
    if (nonce === 0) {
      setState({ status: "idle", data: null });
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: undefined }));
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/life-insurance-summary`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source,
            mutations: mutationsRef.current,
            assumptions: assumptionsRef.current,
            modelPortfolioLabel: labelRef.current,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as LiSolved;
        if (ac.signal.aborted) return;
        setState({ status: "ready", data });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => ac.abort();
    // Only the nonce (Run/Recalculate) launches a solve; source changes reset via
    // the nonce===0 branch. mutations/assumptions/label are read live via refs.
  }, [clientId, source, nonce]);

  return state;
}
