// src/lib/risk/capacity.ts
//
// Capacity for the risk profile. Reuses computeCapacityScore from the
// insights battery unchanged. The per-factor breakdown the detail page shows
// (so an advisor can see WHY capacity is 41) lives in risk-capacity.ts as
// `capacityFactors` -- computeCapacityScore is defined in terms of it, so
// there is exactly one place the four weighted curves are written down.
// Re-exported here so this module's public surface is unchanged for the
// existing test import and any future UI import.
//
// There is no persisted projection and no plan-save hook -- runProjection is a
// pure engine function called at read time from ~10 sites. withComputeCache
// keys on an input hash of the effective tree, so this recomputes exactly when
// the plan changed and serves cache otherwise.
import { withComputeCache } from "@/lib/compute-cache/cache-shell";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";
import { hashRiskCapacityInputs } from "@/lib/compute-cache/hash";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { fundingScore } from "@/lib/retirement/retirement-funding-score";
import { loadCmaReturnBounds } from "@/lib/insights/cma-bounds";
import { deriveInsightInputs } from "@/lib/insights/derive";
import {
  computeCapacityScore,
  computeRequiredGrowthPct,
  capacityFactors,
  type CapacityFactors,
} from "@/lib/insights/risk-capacity";
import { recomputeProfile } from "./profile";

export { capacityFactors, type CapacityFactors } from "@/lib/insights/risk-capacity";

export interface CapacityResult {
  capacityScore: number;
  requiredGrowthPct: number;
  factors: CapacityFactors;
}

/**
 * Compute (or serve cached) capacity for a household's base scenario, then
 * write it onto the profile through recomputeProfile so the Risk list's
 * denormalized snapshot stays in step.
 *
 * recomputeProfile runs INSIDE the `compute` callback below -- only on an
 * actual cache miss (or forceRefresh), never on a cache hit -- so a page view
 * that hits cache doesn't re-lock and rewrite client_risk_profiles for no
 * reason. It also means a profile-write failure prevents the cache row from
 * being written (withComputeCache persists only after `compute` resolves), so
 * the next call retries both instead of stranding a stale profile behind a
 * cached-but-never-recorded result.
 */
export async function getOrComputeCapacity(args: {
  clientId: string;
  firmId: string;
  forceRefresh?: boolean;
}): Promise<CapacityResult> {
  const realScenarioId = await resolveScenarioId(args.clientId, "base");
  const { effectiveTree } = await loadEffectiveTree(
    args.clientId,
    args.firmId,
    "base",
    {},
  );
  // Loaded outside `compute` because the hash depends on it -- a CMA edit has
  // to produce a different key, not just a different result.
  const { cashReturn, equityReturn } = await loadCmaReturnBounds(args.firmId);

  const inputHash = hashRiskCapacityInputs({
    tree: effectiveTree,
    cashReturn,
    equityReturn,
  });

  return withComputeCache<CapacityResult>({
    firmId: args.firmId,
    clientId: args.clientId,
    realScenarioId,
    kind: "risk_capacity",
    inputHash,
    trials: 0,
    forceRefresh: args.forceRefresh,
    label: "risk_capacity",
    compute: async () => {
      const overview = await getOverviewData(args.clientId, args.firmId, "base");
      const projection = overview.projection;
      const score = projection.length > 0 ? fundingScore(projection) : 1;
      const currentAge =
        projection[0]?.ages.client ?? overview.client.retirementAge;

      const { capacity, required } = deriveInsightInputs({
        projection,
        currentAge,
        retirementAge: overview.client.retirementAge,
        planEndAge: overview.client.planEndAge,
        fundingScore: score,
        cashReturn,
        equityReturn,
      });

      const result: CapacityResult = {
        capacityScore: computeCapacityScore(capacity),
        requiredGrowthPct: computeRequiredGrowthPct(required),
        factors: capacityFactors(capacity),
      };

      // Only reached on an actual compute -- see the doc comment above.
      await recomputeProfile({
        clientId: args.clientId,
        firmId: args.firmId,
        actorUserId: null,
        kind: "capacity_changed",
        reason: "plan change",
        patch: {
          capacityScore: result.capacityScore,
          requiredGrowthPct: result.requiredGrowthPct,
          capacityFactors: result.factors,
          capacityComputedAt: new Date(),
        },
      });

      return result;
    },
  });
}
