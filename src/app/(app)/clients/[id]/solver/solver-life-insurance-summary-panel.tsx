// src/app/(app)/clients/[id]/solver/solver-life-insurance-summary-panel.tsx
"use client";
import { useMemo, useState } from "react";
import { LifeInsuranceSummaryView } from "@/components/solver/summaries/life-insurance-summary-view";
import { SummarySkeleton } from "@/components/solver/summaries/primitives";
import { buildLifeInsuranceSummaryData } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import { LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { SolverMutation } from "@/lib/solver/types";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { useSolverLifeInsuranceSolve } from "./use-solver-life-insurance-solve";

interface Props {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  assumptions: LiAssumptions;
  modelPortfolioLabel: string;
  /** Summary context (carries the loaded LI policy inventory). */
  context: BuildDataContext;
}

/**
 * Run-button-gated Life Insurance summary. Before running, renders the policy
 * inventory (not-solved state); Run/Recalculate fires the working-tree solve and
 * fills in the coverage-gap cards + need-over-time chart. Mirrors
 * SolverRetirementComparisonPanel — the coverage solve is a heavy 250-trial
 * Monte Carlo, so it never fires on edit.
 */
export function SolverLifeInsuranceSummaryPanel({
  clientId, source, mutations, assumptions, modelPortfolioLabel, context,
}: Props) {
  // nonce === 0 means "not run yet"; each Run/Recalculate bumps it to launch a solve.
  const [nonce, setNonce] = useState(0);
  const run = () => setNonce((n) => n + 1);

  const li = useSolverLifeInsuranceSolve({
    clientId, source, mutations, assumptions, modelPortfolioLabel, nonce,
  });

  // Build the summary view with whatever we have: the inventory always renders;
  // `solved` (the only option the view-model consumes) fills in the gap cards +
  // need-over-time chart once a run lands.
  const data = useMemo(() => {
    try {
      return buildLifeInsuranceSummaryData(context, {
        ...LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT,
        solved: li.data,
      });
    } catch (err) {
      console.error("[SolverLifeInsuranceSummaryPanel] build threw", err);
      return null;
    }
  }, [context, li.data]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-3">
          Coverage need vs. policies on file — includes Monte Carlo &amp; need-over-time.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={li.status === "loading"}
          className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {li.status === "loading" ? "Running…" : li.status === "ready" ? "Recalculate" : "Run analysis"}
        </button>
      </div>

      {li.status === "error" ? (
        <div className="rounded border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
          Couldn&apos;t run the analysis: {li.error}
        </div>
      ) : null}

      {li.status === "loading" ? (
        <SummarySkeleton label="Solving coverage need (Monte Carlo)…" />
      ) : data ? (
        <LifeInsuranceSummaryView data={data} />
      ) : null}
    </div>
  );
}
