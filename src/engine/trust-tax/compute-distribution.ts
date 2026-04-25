import type {
  DistributionPolicy,
  TrustIncomeBuckets,
  TrustLiquidityPool,
  DistributionResult,
  TrustWarning,
} from "./types";

export interface ComputeDistributionInputs {
  entityId: string;
  policy: DistributionPolicy;
  income: TrustIncomeBuckets;
  liquid: TrustLiquidityPool;
}

export function computeDistribution(inp: ComputeDistributionInputs): DistributionResult {
  const warnings: TrustWarning[] = [];
  const totalIncome = inp.income.ordinary + inp.income.dividends + inp.income.taxExempt;
  const totalLiquid = inp.liquid.cash + inp.liquid.taxableBrokerage + inp.liquid.retirementInRmdPhase;

  const targetAmount = computeTarget(inp.policy, totalIncome, totalLiquid);

  // Fund from cash first, then taxable brokerage. Retirement is in the
  // pct_liquid base (via RMDs) but not drawable beyond what's in cash.
  const fundableLiquid = inp.liquid.cash + inp.liquid.taxableBrokerage;
  const actualAmount = Math.min(targetAmount, fundableLiquid);
  const drawFromCash = Math.min(actualAmount, inp.liquid.cash);
  const drawFromTaxable = actualAmount - drawFromCash;

  if (targetAmount > fundableLiquid) {
    warnings.push({
      code: "trust_distribution_insufficient_liquid",
      entityId: inp.entityId,
      shortfall: targetAmount - fundableLiquid,
    });
  }

  const dniTotal = Math.min(actualAmount, totalIncome);
  const splitPro = (portion: number) =>
    totalIncome > 0 ? dniTotal * (portion / totalIncome) : 0;

  return {
    targetAmount,
    actualAmount,
    drawFromCash,
    drawFromTaxable,
    dniOrdinary: splitPro(inp.income.ordinary),
    dniDividends: splitPro(inp.income.dividends),
    dniTaxExempt: splitPro(inp.income.taxExempt),
    warnings,
  };
}

function computeTarget(policy: DistributionPolicy, totalIncome: number, totalLiquid: number): number {
  if (policy.mode === null) return 0;
  switch (policy.mode) {
    case "fixed":
      return policy.amount ?? 0;
    case "pct_income":
      return (policy.percent ?? 0) * totalIncome;
    case "pct_liquid":
      return (policy.percent ?? 0) * totalLiquid;
  }
}
