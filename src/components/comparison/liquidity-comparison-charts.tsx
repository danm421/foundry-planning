"use client";

import { YearlyLiquidityChart } from "@/components/yearly-liquidity-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

interface Props {
  plans: ComparisonPlan[];
}

// Transitional 2-up rendering — Task 14 rebuilds this visually for N plans.
// We keep the prop surface aligned with the post-Task-13 estate section so the
// build stays green; visually we still only show the first two plans here.
export function LiquidityComparisonCharts({ plans }: Props) {
  const plan1 = plans[0];
  const plan2 = plans[1] ?? plans[0];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-100">Estate Liquidity</h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 text-center text-sm font-semibold text-slate-100">
            {plan1.label}
          </div>
          <YearlyLiquidityChart rows={plan1.liquidityRows} showPortfolio />
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 text-center text-sm font-semibold text-slate-100">
            {plan2.label}
          </div>
          <YearlyLiquidityChart rows={plan2.liquidityRows} showPortfolio />
        </div>
      </div>
    </div>
  );
}
