"use client";

import { useEffect, useState } from "react";
import {
  runMonteCarlo,
  summarizeMonteCarlo,
  createReturnEngine,
} from "@/engine";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import {
  MonteCarloComparisonSection,
  type PlanMcData,
} from "@/components/comparison/monte-carlo-comparison-section";
import { LongevityComparisonSection } from "@/components/comparison/longevity-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
  onMcSuccess?: (planIndex: number, successRate: number) => void;
}

export function MonteCarloAndLongevity({
  clientId,
  plans,
  onMcSuccess,
}: Props) {
  const [state, setState] = useState<
    | {
        status: "loading";
        phase: "fetching" | "running";
        done: number;
        total: number;
      }
    | {
        status: "ready";
        data: { perPlan: PlanMcData[]; threshold: number };
      }
    | { status: "error"; message: string }
  >({ status: "loading", phase: "fetching", done: 0, total: 0 });

  // Build a stable key so the effect doesn't re-run on every parent render.
  const plansKey = plans.map((p) => p.id).join(",");

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
        const accountMixes = new Map(
          payload.accountMixes.map((a) => [a.accountId, a.mix]),
        );
        const trials = 1000;
        const total = trials * plans.length;
        setState({ status: "loading", phase: "running", done: 0, total });
        const dones = new Array(plans.length).fill(0);
        const onTick = () => {
          if (cancelled) return;
          setState({
            status: "loading",
            phase: "running",
            done: dones.reduce((a, b) => a + b, 0),
            total,
          });
        };
        const inputCommon = {
          returnEngine: engine,
          accountMixes,
          trials,
          requiredMinimumAssetLevel: payload.requiredMinimumAssetLevel,
        };
        const results = await Promise.all(
          plans.map((plan, i) =>
            runMonteCarlo({
              data: plan.tree,
              ...inputCommon,
              onProgress: (done) => {
                dones[i] = done;
                onTick();
              },
            }),
          ),
        );
        if (cancelled) return;
        const perPlan: PlanMcData[] = results.map((r, i) => ({
          label: plans[i].label,
          successRate: r.successRate,
          result: r,
          summary: summarizeMonteCarlo(r, {
            client: plans[i].tree.client,
            planSettings: plans[i].tree.planSettings,
            startingLiquidBalance: payload.startingLiquidBalance,
          }),
        }));
        setState({
          status: "ready",
          data: { perPlan, threshold: payload.requiredMinimumAssetLevel },
        });
        results.forEach((r, i) => onMcSuccess?.(i, r.successRate));
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
    // plansKey captures the identity of the plans array by id; onMcSuccess is
    // referenced inside but a callback identity change shouldn't re-run MC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, plansKey]);

  if (state.status === "loading") {
    return (
      <>
        <MonteCarloLoadingPanel
          phase={state.phase}
          done={state.done}
          total={state.total}
          planCount={plans.length}
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
  const perPlan = state.data.perPlan;
  const plan1 = perPlan[0];
  const plan2 = perPlan[1] ?? perPlan[0];
  const planStartYear =
    plans[0]?.result.years[0]?.year ?? new Date().getFullYear();
  const clientBirthYear = plans[0]?.tree.client.dateOfBirth
    ? parseInt(plans[0].tree.client.dateOfBirth.slice(0, 4), 10) || undefined
    : undefined;
  return (
    <>
      <MonteCarloComparisonSection plansMc={perPlan} />
      <LongevityComparisonSection
        plan1Matrix={plan1.result.byYearLiquidAssetsPerTrial}
        plan2Matrix={plan2.result.byYearLiquidAssetsPerTrial}
        threshold={state.data.threshold}
        planStartYear={planStartYear}
        plan1Label={plan1.label}
        plan2Label={plan2.label}
        clientBirthYear={clientBirthYear}
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
  planCount,
}: {
  phase: "fetching" | "running";
  done: number;
  total: number;
  planCount: number;
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
              : `Simulating ${trialFmt.format(total)} trials across ${planCount} plan${planCount === 1 ? "" : "s"}. This can take a moment.`}
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
