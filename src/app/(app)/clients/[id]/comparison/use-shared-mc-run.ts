"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createReturnEngine,
  runMonteCarlo,
  summarizeMonteCarlo,
} from "@/engine";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { PlanMcData } from "@/components/comparison/monte-carlo-comparison-section";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CachedMonteCarloResult } from "@/lib/compute-cache/monte-carlo";

interface Args {
  clientId: string;
  plans: ComparisonPlan[];
  enabled: boolean;
}

export interface SharedMcState {
  status: "idle" | "loading" | "ready" | "error";
  phase?: "fetching" | "running";
  done?: number;
  total?: number;
  result?: McSharedResult;
  error?: string;
}

export interface SharedMcController extends SharedMcState {
  retry: () => void;
}

/**
 * A plan is cacheable when it points at a saved scenario (kind "scenario").
 * Its `ref.id` is the scenario id ("base" is accepted by the cache route).
 * Snapshot plans are frozen JSON with no scenario id — they fall back to a
 * client-side runMonteCarlo (see fallback path below).
 */
function cacheScenarioId(plan: ComparisonPlan): string | null {
  return plan.ref.kind === "scenario" ? plan.ref.id : null;
}

export function useSharedMcRun({ clientId, plans, enabled }: Args): SharedMcController {
  const [state, setState] = useState<SharedMcState>({ status: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const plansKey = plans.map((p) => p.id).join(",");

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", phase: "fetching", done: 0, total: 0 });
    (async () => {
      try {
        // Saved-scenario plans fetch their cached MC result per scenario.
        // Snapshot plans have no cacheable id → client-side fallback run.
        const fallbackPlans = plans.filter((p) => cacheScenarioId(p) === null);

        // Only the fallback (snapshot) plans need the raw MC payload + a
        // local Monte Carlo run; fetch it lazily.
        let engine: ReturnType<typeof createReturnEngine> | null = null;
        let accountMixes: Map<string, AccountAssetMix[]> | null = null;
        let fallbackPayload: MonteCarloPayload | null = null;
        if (fallbackPlans.length > 0) {
          const res = await fetch(`/api/clients/${clientId}/monte-carlo-data`);
          if (!res.ok) throw new Error(`MC payload fetch failed: ${res.status}`);
          fallbackPayload = (await res.json()) as MonteCarloPayload;
          if (cancelled) return;
          engine = createReturnEngine({
            indices: fallbackPayload.indices,
            correlation: fallbackPayload.correlation,
            seed: fallbackPayload.seed,
          });
          accountMixes = new Map(
            fallbackPayload.accountMixes.map((a) => [a.accountId, a.mix]),
          );
        }

        const trials = 1000;
        const total = trials * fallbackPlans.length;
        setState({ status: "loading", phase: "running", done: 0, total });
        const dones = new Array(fallbackPlans.length).fill(0);
        const onTick = () => {
          if (cancelled) return;
          setState((s) => ({
            ...s,
            status: "loading",
            phase: "running",
            done: dones.reduce((a, b) => a + b, 0),
            total,
          }));
        };

        // Per-plan: either a cached fetch (saved scenario) or a client-side
        // run (snapshot fallback). Cached entries also carry `meta`, which we
        // use below for the first plan's page-level threshold/year derivations.
        const entries = await Promise.all(
          plans.map(
            async (
              plan,
            ): Promise<{
              data: PlanMcData;
              meta: CachedMonteCarloResult["meta"] | null;
            }> => {
              const scenarioId = cacheScenarioId(plan);
              if (scenarioId !== null) {
                const res = await fetch(
                  `/api/clients/${clientId}/monte-carlo?scenario=${encodeURIComponent(scenarioId)}`,
                );
                if (!res.ok) {
                  throw new Error(
                    `MC fetch failed for ${plan.label}: ${res.status}`,
                  );
                }
                const cached = (await res.json()) as CachedMonteCarloResult;
                return {
                  data: {
                    planId: plan.id,
                    label: plan.label,
                    successRate: cached.raw.successRate,
                    result: cached.raw,
                    summary: cached.payload.summary,
                  },
                  meta: cached.meta,
                };
              }

              // Fallback: snapshot plan, run Monte Carlo client-side.
              const fbIndex = fallbackPlans.indexOf(plan);
              const r = await runMonteCarlo({
                data: plan.tree,
                returnEngine: engine!,
                accountMixes: accountMixes!,
                trials,
                requiredMinimumAssetLevel:
                  fallbackPayload!.requiredMinimumAssetLevel,
                onProgress: (done) => {
                  dones[fbIndex] = done;
                  onTick();
                },
              });
              return {
                data: {
                  planId: plan.id,
                  label: plan.label,
                  successRate: r.successRate,
                  result: r,
                  summary: summarizeMonteCarlo(r, {
                    client: plan.tree.client,
                    planSettings: plan.tree.planSettings,
                    startingLiquidBalance: fallbackPayload!.startingLiquidBalance,
                  }),
                },
                meta: null,
              };
            },
          ),
        );
        if (cancelled) return;

        const perPlan: PlanMcData[] = entries.map((e) => e.data);
        const successByIndex: Record<number, number> = {};
        perPlan.forEach((p, i) => {
          successByIndex[i] = p.successRate;
        });

        // Page-level threshold / plan-start-year / birth-year come from the
        // first plan. For a saved scenario these are sourced from the cached
        // `meta`; for a snapshot fallback we re-derive them client-side from
        // the plan's tree + projection (as the old hook did).
        const firstPlan = plans[0];
        const firstMeta = entries[0]?.meta ?? null;
        let threshold = fallbackPayload?.requiredMinimumAssetLevel ?? 0;
        let planStartYear = new Date().getFullYear();
        let clientBirthYear: number | undefined;
        if (firstMeta) {
          threshold = firstMeta.requiredMinimumAssetLevel;
          planStartYear = firstMeta.planStartYear;
          clientBirthYear = firstMeta.clientBirthYear;
        } else if (firstPlan) {
          planStartYear =
            firstPlan.result.years[0]?.year ?? new Date().getFullYear();
          clientBirthYear = firstPlan.tree.client.dateOfBirth
            ? parseInt(firstPlan.tree.client.dateOfBirth.slice(0, 4), 10) ||
              undefined
            : undefined;
        }

        setState({
          status: "ready",
          result: {
            perPlan,
            threshold,
            successByIndex,
            planStartYear,
            clientBirthYear,
          },
        });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, plansKey, enabled, retryNonce]);

  return { ...state, retry };
}
