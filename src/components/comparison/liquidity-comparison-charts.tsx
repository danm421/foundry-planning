"use client";

import { YearlyLiquidityChart } from "@/components/yearly-liquidity-chart";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";

interface Props {
  plan1Label: string;
  plan2Label: string;
  plan1Rows: YearlyLiquidityReport["rows"];
  plan2Rows: YearlyLiquidityReport["rows"];
}

export function LiquidityComparisonCharts({
  plan1Label,
  plan2Label,
  plan1Rows,
  plan2Rows,
}: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-100">Estate Liquidity</h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 text-center text-sm font-semibold text-slate-100">
            {plan1Label}
          </div>
          <YearlyLiquidityChart rows={plan1Rows} showPortfolio />
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 text-center text-sm font-semibold text-slate-100">
            {plan2Label}
          </div>
          <YearlyLiquidityChart rows={plan2Rows} showPortfolio />
        </div>
      </div>
    </div>
  );
}
