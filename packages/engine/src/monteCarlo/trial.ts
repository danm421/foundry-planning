import { runProjection } from "../projection";
import type { ClientData, ProjectionYear } from "../types";
import type { ReturnEngine } from "./returns";

export interface AccountAssetMix {
  assetClassId: string;
  /** 0-1 fraction; per-account weights should sum to ≤ 1. Any residual is
   *  implicitly uncorrelated (treated as cash-like / non-randomized). */
  weight: number;
}

export interface RunTrialInput {
  data: ClientData;
  returnEngine: ReturnEngine;
  trialIndex: number;
  /**
   * Asset-class mix per account id. Accounts absent from the map keep their
   * fixed `growthRate` — per the eMoney whitepaper, custom growth rates,
   * inflation-linked rates, and non-investable asset types (real estate,
   * business, life insurance) do not randomize.
   */
  accountMixes: Map<string, AccountAssetMix[]>;
  /** PDF p.14: "Minimum Assets for Solving" — end-of-sim threshold. */
  requiredMinimumAssetLevel: number;
}

export interface TrialResult {
  success: boolean;
  endingLiquidAssets: number;
  /** Liquid portfolio value per year, in plan-year order. Used for fan-chart
   *  and percentile aggregation in Phase 6. */
  byYearLiquidAssets: number[];
}

/**
 * Liquid portfolio assets per the eMoney whitepaper (p.11): investments held
 * in the estate of the client/spouse. Real estate, businesses, and life
 * insurance are excluded — they can't be liquidated cleanly to cover a
 * shortfall.
 */
export function liquidPortfolioTotal(
  y: Pick<ProjectionYear, "portfolioAssets">,
): number {
  return (
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal
  );
}

/** Classify a full projection as success/failure using the two PDF p.11 checks. */
function classifyTrial(liquids: number[], requiredMinimum: number): boolean {
  for (const v of liquids) {
    if (v < 0) return false; // check (b): >= $0 in all simulated years
  }
  // check (a): >= requiredMinimum at end of simulation
  return liquids[liquids.length - 1] >= requiredMinimum;
}

export function runTrial(input: RunTrialInput): TrialResult {
  const { data, returnEngine, trialIndex, accountMixes, requiredMinimumAssetLevel } = input;
  const stream = returnEngine.startTrial(trialIndex);
  const indexOrder = returnEngine.indices;

  // Per-year cache of the drawn return vector, keyed by year. The engine's
  // growth pass iterates accounts within a year, so the closure pulls one
  // vector per year and serves all accounts from it.
  const drawsByYear = new Map<number, Record<string, number>>();

  const returnsOverride = (year: number, accountId: string): number | undefined => {
    const mix = accountMixes.get(accountId);
    if (!mix || mix.length === 0) return undefined; // fixed-rate account

    let yearReturns = drawsByYear.get(year);
    if (!yearReturns) {
      const vec = stream.nextYear();
      yearReturns = Object.create(null) as Record<string, number>;
      for (let i = 0; i < indexOrder.length; i++) {
        yearReturns[indexOrder[i]] = vec[i];
      }
      drawsByYear.set(year, yearReturns);
    }

    let weighted = 0;
    for (const m of mix) {
      const r = yearReturns[m.assetClassId];
      if (r !== undefined) weighted += m.weight * r;
      // Missing asset-class in the engine = treated as 0 return for that slice.
      // Orchestrator is expected to only include accounts whose mix references
      // engine indices; this is a defensive fallback.
    }
    return weighted;
  };

  const years = runProjection(data, { returnsOverride });
  const byYearLiquidAssets = years.map(liquidPortfolioTotal);
  const endingLiquidAssets = byYearLiquidAssets[byYearLiquidAssets.length - 1];
  const success = classifyTrial(byYearLiquidAssets, requiredMinimumAssetLevel);

  return { success, endingLiquidAssets, byYearLiquidAssets };
}
