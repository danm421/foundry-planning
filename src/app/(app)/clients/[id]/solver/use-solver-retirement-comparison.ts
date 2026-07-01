// src/app/(app)/clients/[id]/solver/use-solver-retirement-comparison.ts
"use client";
import { useEffect, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import type { RetirementComparisonPageData } from "@/lib/presentations/pages/retirement-comparison/types";

export interface SolverRetirementComparisonState {
  status: "idle" | "loading" | "ready" | "error";
  data: RetirementComparisonPageData | null;
  error?: string;
}

interface Args {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  extraAccountMixes?: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
  /** 0 = not run yet; bump to launch a fresh run (Run / Recalculate). */
  nonce: number;
}

export function useSolverRetirementComparison({
  clientId, source, mutations, extraAccountMixes = [], nonce,
}: Args): SolverRetirementComparisonState {
  const [state, setState] = useState<SolverRetirementComparisonState>({ status: "idle", data: null });
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  useEffect(() => {
    if (nonce === 0) {
      setState({ status: "idle", data: null });
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: undefined }));
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/retirement-comparison`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source,
            mutations: mutationsRef.current,
            ...(extraAccountMixes.length ? { extraAccountMixes } : {}),
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as RetirementComparisonPageData;
        if (ac.signal.aborted) return;
        setState({ status: "ready", data });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, source, nonce, JSON.stringify(extraAccountMixes)]);

  return state;
}
