import type { AlignedWindows } from "@/lib/investments/rebalance/common-window";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";
import { buildFeeComparison } from "./fees";
import { buildSuitability, type BuildSuitabilityInput } from "./suitability";
import { buildBacktestSeries, buildStressWindows } from "./backtest";
import { buildOutcomeCone } from "./outcomes";
import { computeBreakEven } from "./break-even";
import type { FeeHolding, ProposalSnapshot, ProposedHolding, RiskLevel } from "./types";

/** Horizons shown on the range-of-outcomes page. */
const OUTCOME_YEARS = [10, 20] as const;

export interface BuildProposalSnapshotInput {
  compute: RebalanceComputeResult;
  computedAt: string;
  currentFeeHoldings: readonly FeeHolding[];
  proposedFeeHoldings: readonly FeeHolding[];
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
  aligned: AlignedWindows;
  profile: BuildSuitabilityInput["profile"];
  currentLevel: RiskLevel | null;
  proposedLevel: RiskLevel | null;
  rungs: BuildSuitabilityInput["rungs"];
  targetHoldings: readonly ProposedHolding[];
}

/** Assemble the frozen artifact. Pure — every input is already resolved. */
export function buildProposalSnapshot(input: BuildProposalSnapshotInput): ProposalSnapshot {
  const totalValue = input.compute.current.totalValue;

  const fees = buildFeeComparison({
    totalValue,
    currentHoldings: input.currentFeeHoldings,
    proposedHoldings: input.proposedFeeHoldings,
    advisoryFeeCurrent: input.advisoryFeeCurrent,
    advisoryFeeProposed: input.advisoryFeeProposed,
  });

  // The saving is only usable in the break-even when both sides produced a
  // blend; a one-sided number would compare a fee against nothing.
  const feeSavingRate =
    fees.currentBlendedEr != null && fees.proposedBlendedEr != null
      ? fees.currentBlendedEr +
        (fees.advisoryFeeCurrent ?? 0) -
        (fees.proposedBlendedEr + (fees.advisoryFeeProposed ?? 0))
      : null;

  return {
    version: 1,
    computedAt: input.computedAt,
    compute: input.compute,
    fees,
    suitability: buildSuitability({
      profile: input.profile,
      currentLevel: input.currentLevel,
      currentVolatility: input.compute.current.cma.stdDev,
      proposedLevel: input.proposedLevel,
      proposedVolatility: input.compute.proposed.cma.stdDev,
      rungs: input.rungs,
    }),
    backtest: buildBacktestSeries(input.aligned),
    stress: buildStressWindows(input.aligned, totalValue),
    outcomes: buildOutcomeCone({
      startValue: totalValue,
      current: {
        arithmeticMean: input.compute.current.cma.arithmeticMean,
        stdDev: input.compute.current.cma.stdDev,
      },
      proposed: {
        arithmeticMean: input.compute.proposed.cma.arithmeticMean,
        stdDev: input.compute.proposed.cma.stdDev,
      },
      years: [...OUTCOME_YEARS],
    }),
    breakEven: computeBreakEven({
      estimatedTax: input.compute.tax.estimatedTax,
      totalValue,
      returnDelta:
        input.compute.proposed.cma.geometricReturn - input.compute.current.cma.geometricReturn,
      feeSavingRate,
    }),
    targetHoldings: [...input.targetHoldings],
  };
}
