import type { ProjectionYear } from "@/engine/types";
import type { CapacityInputs, RequiredInputs } from "./risk-capacity";

/** Growth-asset share (0..100) from a getAssetAllocationByType rollup. */
export function growthPctFromAllocation(
  rollup: Array<{ group: string; pct: number }>,
): number {
  const equities = rollup
    .filter((r) => r.group === "equities")
    .reduce((s, r) => s + r.pct, 0);
  return Math.round(equities * 100);
}

export interface DeriveArgs {
  projection: ProjectionYear[];
  currentAge: number;
  retirementAge: number;
  planEndAge: number;
  fundingScore: number;
  cashReturn: number;
  equityReturn: number;
}

export function deriveInsightInputs(args: DeriveArgs): {
  capacity: CapacityInputs;
  required: RequiredInputs;
} {
  const { projection, currentAge, retirementAge, planEndAge } = args;
  const retIdx = projection.findIndex((y) => y.ages.client >= retirementAge);
  const retYears = retIdx >= 0 ? projection.slice(retIdx) : [];

  const startingLiquidAssets =
    retYears[0]?.portfolioAssets.liquidTotal ??
    projection[0]?.portfolioAssets.liquidTotal ??
    0;

  const netOutflows = retYears.map((y) =>
    Math.max(y.expenses.total - y.income.total, 0),
  );
  const avgAnnualRealNetWithdrawal =
    netOutflows.length > 0
      ? netOutflows.reduce((s, x) => s + x, 0) / netOutflows.length
      : 0;

  const first = retYears[0];
  const guaranteedIncomeCoverage =
    first && first.expenses.total > 0
      ? (first.income.socialSecurity + first.income.deferred) /
        first.expenses.total
      : 0;

  const horizonYears = Math.max(planEndAge - currentAge, 0);
  const withdrawalRate =
    startingLiquidAssets > 0
      ? avgAnnualRealNetWithdrawal / startingLiquidAssets
      : 0;

  return {
    capacity: {
      horizonYears,
      fundingScore: args.fundingScore,
      withdrawalRate,
      guaranteedIncomeCoverage,
    },
    required: {
      startingLiquidAssets,
      avgAnnualRealNetWithdrawal,
      horizonYears: Math.max(planEndAge - retirementAge, 0),
      cashReturn: args.cashReturn,
      equityReturn: args.equityReturn,
    },
  };
}
