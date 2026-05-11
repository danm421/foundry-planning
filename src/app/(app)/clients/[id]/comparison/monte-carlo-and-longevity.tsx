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
    | { status: "loading"; phase: "fetching" | "running"; done: number; total: number }
    | { status: "ready"; data: RunPair }
    | { status: "error"; message: string }
  >({ status: "loading", phase: "fetching", done: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/monte-carlo-data`);
        if (!res.ok) throw new Error(`MC payload fetch failed: ${res.status}`);
        const payload = (await res.json()) as MonteCarloPayload;
        if (cancelled) return;
        const engine = createReturnEngine({
          indices: payload.indices,
          correlation: payload.correlation,
          seed: payload.seed,
        });
        const accountMixes = new Map(payload.accountMixes.map((a) => [a.accountId, a.mix]));
        const trials = 1000;
        setState({ status: "loading", phase: "running", done: 0, total: trials * 2 });
        let plan1Done = 0;
        let plan2Done = 0;
        const onTick = () => {
          if (cancelled) return;
          setState({
            status: "loading",
            phase: "running",
            done: plan1Done + plan2Done,
            total: trials * 2,
          });
        };
        const inputCommon = {
          returnEngine: engine,
          accountMixes,
          trials,
          requiredMinimumAssetLevel: payload.requiredMinimumAssetLevel,
        };
        const [plan1Result, plan2Result] = await Promise.all([
          runMonteCarlo({
            data: plan1Tree,
            ...inputCommon,
            onProgress: (done) => {
              plan1Done = done;
              onTick();
            },
          }),
          runMonteCarlo({
            data: plan2Tree,
            ...inputCommon,
            onProgress: (done) => {
              plan2Done = done;
              onTick();
            },
          }),
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
        <MonteCarloLoadingPanel
          phase={state.phase}
          done={state.done}
          total={state.total}
        />
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
      <div className="h-72 animate-pulse rounded border border-slate-800 bg-slate-900" />
    </section>
  );
}

function MonteCarloLoadingPanel({
  phase,
  done,
  total,
}: {
  phase: "fetching" | "running";
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const trialFmt = new Intl.NumberFormat("en-US");
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Monte Carlo</h2>
      <div className="flex flex-col items-center justify-center gap-4 rounded border border-slate-800 bg-slate-900 px-6 py-12 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-accent" />
        <div>
          <div className="text-sm font-medium text-slate-100">
            {phase === "fetching"
              ? "Loading simulation data…"
              : "Running Monte Carlo simulation…"}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {phase === "fetching"
              ? "Fetching return assumptions and account mixes."
              : `Simulating ${trialFmt.format(total)} trials across both plans. This can take a moment.`}
          </div>
        </div>
        {phase === "running" && total > 0 ? (
          <div className="w-full max-w-sm">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 text-xs tabular-nums text-slate-400">
              {trialFmt.format(done)} / {trialFmt.format(total)} trials
              <span className="ml-2 text-slate-500">({pct}%)</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
