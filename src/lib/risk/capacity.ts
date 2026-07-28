// src/lib/risk/capacity.ts
//
// Capacity for the risk profile. Reuses computeCapacityScore from the insights
// battery unchanged; the only addition is the per-factor breakdown the detail
// page shows so an advisor can see WHY capacity is 41.
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
  CAPACITY_WEIGHTS,
  type CapacityInputs,
} from "@/lib/insights/risk-capacity";
import { recomputeProfile } from "./profile";

export interface CapacityFactors {
  horizon: number;
  buffer: number;
  withdrawal: number;
  incomeFloor: number;
}

export interface CapacityResult {
  capacityScore: number;
  requiredGrowthPct: number;
  factors: CapacityFactors;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The same four factors computeCapacityScore blends, kept separate so the UI
 * can show the breakdown. Formulas mirror risk-capacity.ts exactly -- if that
 * file's curves change, this must change with it (the sum test catches drift).
 */
export function capacityFactors(i: CapacityInputs): CapacityFactors {
  return {
    horizon: CAPACITY_WEIGHTS.horizon * clamp01(i.horizonYears / 30),
    buffer: CAPACITY_WEIGHTS.buffer * clamp01((i.fundingScore - 0.8) / 0.7),
    withdrawal: CAPACITY_WEIGHTS.withdrawal * clamp01(1 - i.withdrawalRate / 0.06),
    incomeFloor: CAPACITY_WEIGHTS.incomeFloor * clamp01(i.guaranteedIncomeCoverage),
  };
}

/**
 * Compute (or serve cached) capacity for a household's base scenario, then
 * write it onto the profile through recomputeProfile so the Risk list's
 * denormalized snapshot stays in step.
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

  const result = await withComputeCache<CapacityResult>({
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

      return {
        capacityScore: computeCapacityScore(capacity),
        requiredGrowthPct: computeRequiredGrowthPct(required),
        factors: capacityFactors(capacity),
      };
    },
  });

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
}
