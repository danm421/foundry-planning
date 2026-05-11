"use client";

import { YearlyLiquidityChart } from "@/components/yearly-liquidity-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";

interface Props {
  plans: ComparisonPlan[];
}

export function LiquidityComparisonCharts({ plans }: Props) {
  const colsClass =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : plans.length === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2";

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-100">Estate Liquidity</h3>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <div
            key={p.index}
            className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
          >
            <div className="mb-2 flex items-center justify-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColor(i) }}
                aria-hidden
              />
              <span className="text-sm font-semibold text-slate-100">{p.label}</span>
            </div>
            <YearlyLiquidityChart rows={p.liquidityRows} showPortfolio />
          </div>
        ))}
      </div>
    </div>
  );
}
