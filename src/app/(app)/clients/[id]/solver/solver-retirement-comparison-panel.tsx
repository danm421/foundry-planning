// src/app/(app)/clients/[id]/solver/solver-retirement-comparison-panel.tsx
"use client";
import { useState } from "react";
import { RetirementComparisonView } from "@/components/solver/summaries/retirement-comparison-view";
import { SummarySkeleton, SummaryEmpty } from "@/components/solver/summaries/primitives";
import { useSolverRetirementComparison } from "./use-solver-retirement-comparison";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";

interface Props {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  extraAccountMixes: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
}

export function SolverRetirementComparisonPanel({ clientId, source, mutations, extraAccountMixes }: Props) {
  // nonce === 0 means "not run yet"; each Run/Recalculate bumps it to launch a fetch.
  const [nonce, setNonce] = useState(0);
  const run = () => setNonce((n) => n + 1);

  const rc = useSolverRetirementComparison({ clientId, source, mutations, extraAccountMixes, nonce });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-3">
          Base Case vs your working plan — includes Monte Carlo &amp; max sustainable spend.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={rc.status === "loading"}
          className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rc.status === "loading" ? "Running…" : rc.status === "ready" ? "Recalculate" : "Run comparison"}
        </button>
      </div>

      {rc.status === "error" ? (
        <div className="rounded border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
          Couldn&apos;t run the comparison: {rc.error}
        </div>
      ) : rc.status === "loading" ? (
        <SummarySkeleton label="Running projections, Monte Carlo, and max-spend…" />
      ) : rc.data ? (
        <RetirementComparisonView data={rc.data} />
      ) : (
        <SummaryEmpty message="Run the comparison to see Base Case vs your working plan." />
      )}
    </div>
  );
}
