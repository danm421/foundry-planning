"use client";
import { useEffect, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";
import type { CachedMonteCarloResult } from "@/lib/compute-cache/monte-carlo";

export interface SolverMcReportState {
  status: "idle" | "loading" | "ready" | "error";
  result: CachedMonteCarloResult | null;
  error?: string;
}

interface Args {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  /** Model portfolio asset mixes to inject for the working-tree gauge. */
  extraAccountMixes?: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
  enabled: boolean;
  /** Bump to launch a fresh run. */
  nonce: number;
}

export function useSolverMcReport({
  clientId, source, mutations, extraAccountMixes = [], enabled, nonce,
}: Args): SolverMcReportState {
  const [state, setState] = useState<SolverMcReportState>({ status: "idle", result: null });
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", result: null });
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: undefined }));
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/monte-carlo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source, mutations: mutationsRef.current, full: true,
            ...(extraAccountMixes.length ? { extraAccountMixes } : {}),
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const result = (await res.json()) as CachedMonteCarloResult;
        if (ac.signal.aborted) return;
        setState({ status: "ready", result });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, source, enabled, nonce, JSON.stringify(extraAccountMixes)]);

  return state;
}
