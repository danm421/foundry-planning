"use client";

import { useEffect, useState } from "react";
import type { ClientData, MonteCarloResult, MonteCarloSummary } from "@/engine";
import {
  runMonteCarlo,
  summarizeMonteCarlo,
  createReturnEngine,
} from "@/engine";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { MonteCarloComparisonSection } from "@/components/comparison/monte-carlo-comparison-section";
import { LongevityComparisonSection } from "@/components/comparison/longevity-comparison-section";

interface Props {
  clientId: string;
  plan1Tree: ClientData;
  plan2Tree: ClientData;
  plan1Label: string;
  plan2Label: string;
  plan1Years: { year: number }[];
  onMcSuccessDelta?: (delta: number) => void;
}

interface RunPair {
  plan1Result: MonteCarloResult;
  plan2Result: MonteCarloResult;
  plan1Summary: MonteCarloSummary;
  plan2Summary: MonteCarloSummary;
  threshold: number;
}

export function MonteCarloAndLongevity({
  clientId,
  plan1Tree,
  plan2Tree,
  plan1Label,
  plan2Label,
  plan1Years,
  onMcSuccessDelta,
}: Props) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; data: RunPair }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/monte-carlo-data`);
        if (!res.ok) throw new Error(`MC payload fetch failed: ${res.status}`);
        const payload = (await res.json()) as MonteCarloPayload;
        const engine = createReturnEngine({
          indices: payload.indices,
          correlation: payload.correlation,
          seed: payload.seed,
        });
        const accountMixes = new Map(payload.accountMixes.map((a) => [a.accountId, a.mix]));
        const inputCommon = {
          returnEngine: engine,
          accountMixes,
          trials: 1000,
          requiredMinimumAssetLevel: payload.requiredMinimumAssetLevel,
        };
        const [plan1Result, plan2Result] = await Promise.all([
          runMonteCarlo({ data: plan1Tree, ...inputCommon }),
          runMonteCarlo({ data: plan2Tree, ...inputCommon }),
        ]);
        if (cancelled) return;
        const summarize = (r: MonteCarloResult, tree: ClientData) =>
          summarizeMonteCarlo(r, {
            client: tree.client,
            planSettings: tree.planSettings,
            startingLiquidBalance: payload.startingLiquidBalance,
          });
        const data: RunPair = {
          plan1Result,
          plan2Result,
          plan1Summary: summarize(plan1Result, plan1Tree),
          plan2Summary: summarize(plan2Result, plan2Tree),
          threshold: payload.requiredMinimumAssetLevel,
        };
        setState({ status: "ready", data });
        onMcSuccessDelta?.(plan2Result.successRate - plan1Result.successRate);
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, plan1Tree, plan2Tree, onMcSuccessDelta]);

  if (state.status === "loading") {
    return (
      <>
        <SectionSkeleton title="Monte Carlo" />
        <SectionSkeleton title="Longevity" />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <div className="px-6 py-8 text-rose-400">
        Monte Carlo failed: {state.message}
      </div>
    );
  }
  return (
    <>
      <MonteCarloComparisonSection
        plan1Result={state.data.plan1Result}
        plan2Result={state.data.plan2Result}
        plan1Summary={state.data.plan1Summary}
        plan2Summary={state.data.plan2Summary}
        plan1Label={plan1Label}
        plan2Label={plan2Label}
      />
      <LongevityComparisonSection
        plan1Matrix={state.data.plan1Result.byYearLiquidAssetsPerTrial}
        plan2Matrix={state.data.plan2Result.byYearLiquidAssetsPerTrial}
        threshold={state.data.threshold}
        planStartYear={plan1Years[0]?.year ?? new Date().getFullYear()}
        plan1Label={plan1Label}
        plan2Label={plan2Label}
        clientBirthYear={
          plan1Tree.client.dateOfBirth
            ? parseInt(plan1Tree.client.dateOfBirth.slice(0, 4), 10) || undefined
            : undefined
        }
      />
    </>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">{title}</h2>
      <div className="h-72 animate-pulse rounded bg-slate-900" />
    </section>
  );
}
