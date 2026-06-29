"use client";
import { MonteCarloReportView } from "@/components/monte-carlo/report-view";
import MonteCarloSkeleton from "@/app/(app)/clients/[id]/cashflow/monte-carlo/loading-skeleton";
import { useSolverMcReport } from "./use-solver-mc-report";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";

interface Props {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  extraAccountMixes: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
  enabled: boolean;
  nonce: number;
}

export function SolverMonteCarloPanel({
  clientId,
  source,
  mutations,
  extraAccountMixes,
  enabled,
  nonce,
}: Props) {
  const mc = useSolverMcReport({ clientId, source, mutations, extraAccountMixes, enabled, nonce });

  if (mc.status === "error") {
    return (
      <div className="rounded border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
        Couldn&apos;t load Monte Carlo: {mc.error}
      </div>
    );
  }
  if (!mc.result) {
    return <MonteCarloSkeleton />;
  }
  return (
    <MonteCarloReportView
      summary={mc.result.payload.summary}
      raw={mc.result.raw}
      deterministic={mc.result.payload.deterministic}
      meta={mc.result.meta}
      loading={mc.status === "loading"}
      showHeader={false}
    />
  );
}
