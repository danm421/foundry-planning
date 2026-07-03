// src/app/(app)/clients/[id]/solver/use-solver-mc.ts
//
// Client consumer for the cached solver Monte Carlo endpoint. POSTs
// { source, mutations } and reads back just { successRate } per column — no
// in-browser Monte Carlo, so the UI thread is never blocked. A run launches
// when `nonce` changes (Recalculate / first auto-run); mutations are read at
// launch time via a ref so edits between runs don't trigger a refetch.
"use client";

import { useEffect, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";

export interface SolverMcState {
  status: "idle" | "loading" | "ready" | "error";
  baseSuccessRate: number | null;
  workingSuccessRate: number | null;
  error?: string;
}

interface Args {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  /** Model portfolio asset mixes to inject for the working-tree gauge. */
  extraAccountMixes?: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
  /** Refetch the Base column too (first/auto run); false on working-only Recalculate. */
  includeBase: boolean;
  enabled: boolean;
  /** Bump to launch a fresh run. */
  nonce: number;
}

async function fetchSuccessRate(
  clientId: string,
  source: string,
  mutations: SolverMutation[],
  extraAccountMixes: { accountId: string; mix: { assetClassId: string; weight: number }[] }[],
  signal: AbortSignal,
): Promise<number> {
  const res = await fetch(`/api/clients/${clientId}/solver/monte-carlo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, mutations, ...(extraAccountMixes.length ? { extraAccountMixes } : {}) }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { successRate: number };
  return data.successRate;
}

export function useSolverMc({
  clientId,
  source,
  mutations,
  extraAccountMixes = [],
  includeBase,
  enabled,
  nonce,
}: Args): SolverMcState {
  const [state, setState] = useState<SolverMcState>({
    status: "idle",
    baseSuccessRate: null,
    workingSuccessRate: null,
  });

  // Read mutations and mixes at launch time, not as effect dependencies —
  // edits between runs must not refetch; only a `nonce` bump launches a run.
  // Mixes especially: a solve minting a draft account (Roth, min-savings)
  // changes them mid-solve, and a dependency here would relaunch the gauge MC
  // to contend with the solve for the function instance's CPU.
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const extraAccountMixesRef = useRef(extraAccountMixes);
  extraAccountMixesRef.current = extraAccountMixes;

  useEffect(() => {
    if (!enabled) {
      // Disabling intentionally drops prior results back to idle.
      setState({ status: "idle", baseSuccessRate: null, workingSuccessRate: null });
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: undefined }));
    (async () => {
      try {
        const m = mutationsRef.current;
        const [workingSuccessRate, baseSuccessRate] = await Promise.all([
          fetchSuccessRate(clientId, source, m, extraAccountMixesRef.current, ac.signal),
          includeBase
            ? fetchSuccessRate(clientId, "base", [], [], ac.signal)
            : Promise.resolve(null),
        ]);
        if (ac.signal.aborted) return;
        setState((s) => ({
          status: "ready",
          // Keep the prior Base value on a working-only Recalculate.
          baseSuccessRate: baseSuccessRate ?? s.baseSuccessRate,
          workingSuccessRate,
        }));
      } catch (err) {
        if (ac.signal.aborted) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
    return () => ac.abort();
  }, [clientId, source, includeBase, enabled, nonce]);

  return state;
}
