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

  // Share of retirement spending met by non-portfolio income.
  //
  // Measured over the retirement years in which that income is actually
  // flowing, NOT at retYears[0]. The engine gates Social Security to the
  // claiming age (see computeIncome in engine/income.ts), which for most
  // households is later than retirementAge -- retire at 65, claim at 67 is the
  // common shape. Sampling only the first retirement year therefore read a
  // zero floor for every one of them, however large the benefit.
  //
  // Aggregate ratio (sum / sum) rather than a mean of per-year ratios, so a
  // single year with a collapsed expense base can't manufacture a full floor.
  //
  // Only `socialSecurity` and `deferred` (pension / deferred comp) count as
  // guaranteed. `other` deliberately does not -- it carries bonuses and
  // overtime, which are not a floor.
  const guaranteed = (y: ProjectionYear) =>
    y.income.socialSecurity + y.income.deferred;
  const floorYears = retYears.filter(
    (y) => guaranteed(y) > 0 && y.expenses.total > 0,
  );
  const floorIncome = floorYears.reduce((s, y) => s + guaranteed(y), 0);
  const floorExpenses = floorYears.reduce((s, y) => s + y.expenses.total, 0);
  const guaranteedIncomeCoverage =
    floorExpenses > 0 ? floorIncome / floorExpenses : 0;

  // Capacity's two clocks. Kept separate on purpose -- see CapacityInputs.
  // An already-retired household floors at 0 on the first and is carried by
  // the second, which is why the second exists.
  const yearsToRetirement = Math.max(retirementAge - currentAge, 0);
  const retirementYears = Math.max(planEndAge - retirementAge, 0);
  const withdrawalRate =
    startingLiquidAssets > 0
      ? avgAnnualRealNetWithdrawal / startingLiquidAssets
      : 0;

  return {
    capacity: {
      yearsToRetirement,
      retirementYears,
      fundingScore: args.fundingScore,
      withdrawalRate,
      guaranteedIncomeCoverage,
    },
    required: {
      startingLiquidAssets,
      avgAnnualRealNetWithdrawal,
      horizonYears: retirementYears,
      cashReturn: args.cashReturn,
      equityReturn: args.equityReturn,
    },
  };
}
