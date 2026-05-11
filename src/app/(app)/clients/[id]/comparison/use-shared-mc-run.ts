"use client";

import { useEffect, useState } from "react";
import {
  createReturnEngine,
  runMonteCarlo,
  summarizeMonteCarlo,
} from "@/engine";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { PlanMcData } from "@/components/comparison/monte-carlo-comparison-section";
import type { McSharedResult } from "@/lib/comparison/widgets/types";

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

export function useSharedMcRun({ clientId, plans, enabled }: Args): SharedMcState {
  const [state, setState] = useState<SharedMcState>({ status: "idle" });
  const plansKey = plans.map((p) => p.id).join(",");

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", phase: "fetching", done: 0, total: 0 });
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
          setState((s) => ({
            ...s,
            status: "loading",
            phase: "running",
            done: dones.reduce((a, b) => a + b, 0),
            total,
          }));
        };
        const results = await Promise.all(
          plans.map((plan, i) =>
            runMonteCarlo({
              data: plan.tree,
              returnEngine: engine,
              accountMixes,
              trials,
              requiredMinimumAssetLevel: payload.requiredMinimumAssetLevel,
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
        const successByIndex: Record<number, number> = {};
        results.forEach((r, i) => {
          successByIndex[i] = r.successRate;
        });
        const planStartYear =
          plans[0]?.result.years[0]?.year ?? new Date().getFullYear();
        const clientBirthYear = plans[0]?.tree.client.dateOfBirth
          ? parseInt(plans[0].tree.client.dateOfBirth.slice(0, 4), 10) || undefined
          : undefined;
        setState({
          status: "ready",
          result: {
            perPlan,
            threshold: payload.requiredMinimumAssetLevel,
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
  }, [clientId, plansKey, enabled]);

  return state;
}
