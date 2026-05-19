import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations, assetClasses } from "@/db/schema";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { ProceedsRealization } from "./solve-need";

/** Resolved LI-proceeds growth for both the straight-line and MC solvers. */
export interface LiProceedsGrowth {
  /** Deterministic blended geometric return for the straight-line solve. */
  rate: number;
  /** Realization mix — present only when a model portfolio is resolved. */
  realization?: ProceedsRealization;
  /** Per-asset-class mix for the Monte Carlo solver. Empty when no portfolio. */
  mix: AccountAssetMix[];
}

/**
 * Resolve `modelPortfolioId` (firm-scoped) into LI-proceeds growth. When the id
 * is null or resolves to no allocations, fall back to the plan's flat
 * life-insurance growth rate (`fallbackRate`) with no realization / empty mix.
 */
export async function loadLiProceedsGrowth(
  firmId: string,
  modelPortfolioId: string | null,
  fallbackRate: number,
): Promise<LiProceedsGrowth> {
  if (!modelPortfolioId) return { rate: fallbackRate, mix: [] };

  const [portfolio] = await db
    .select({ id: modelPortfolios.id })
    .from(modelPortfolios)
    .where(and(eq(modelPortfolios.id, modelPortfolioId), eq(modelPortfolios.firmId, firmId)));
  if (!portfolio) return { rate: fallbackRate, mix: [] };

  const allocRows = await db
    .select({
      assetClassId: modelPortfolioAllocations.assetClassId,
      weight: modelPortfolioAllocations.weight,
    })
    .from(modelPortfolioAllocations)
    .where(eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolioId));
  if (allocRows.length === 0) return { rate: fallbackRate, mix: [] };

  const acRows = await db
    .select()
    .from(assetClasses)
    .where(eq(assetClasses.firmId, firmId));
  const acMap = new Map(acRows.map((ac) => [ac.id, ac]));

  let rate = 0;
  let pctOrdinaryIncome = 0;
  let pctLtCapitalGains = 0;
  let pctQualifiedDividends = 0;
  let pctTaxExempt = 0;
  const mix: AccountAssetMix[] = [];

  for (const alloc of allocRows) {
    const ac = acMap.get(alloc.assetClassId);
    if (!ac) continue;
    const w = parseFloat(alloc.weight);
    rate += w * parseFloat(ac.geometricReturn);
    pctOrdinaryIncome += w * parseFloat(ac.pctOrdinaryIncome);
    pctLtCapitalGains += w * parseFloat(ac.pctLtCapitalGains);
    pctQualifiedDividends += w * parseFloat(ac.pctQualifiedDividends);
    pctTaxExempt += w * parseFloat(ac.pctTaxExempt);
    mix.push({ assetClassId: alloc.assetClassId, weight: w });
  }

  return {
    rate,
    realization: {
      pctOrdinaryIncome,
      pctLtCapitalGains,
      pctQualifiedDividends,
      pctTaxExempt,
      turnoverPct: 0,
    },
    mix,
  };
}
