"use client";

import { AssetAllocationDonut, type AssetAllocationDonutMode } from "@/components/investments/asset-allocation-donut";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";

interface Props {
  plans: ComparisonPlan[];
  mode: AssetAllocationDonutMode;
}

function PlanColumn({ plan, index, mode }: { plan: ComparisonPlan; index: number; mode: AssetAllocationDonutMode }) {
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      {plan.allocation && plan.allocation.totalInvestableValue > 0 ? (
        <AssetAllocationDonut household={plan.allocation} mode={mode} size={200} showHeader={false} />
      ) : (
        <p className="text-sm text-slate-400">No investable accounts.</p>
      )}
    </div>
  );
}

export function AssetAllocationComparisonSection({ plans, mode }: Props) {
  const hasAny = plans.some((p) => p.allocation && p.allocation.totalInvestableValue > 0);
  if (!hasAny) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Asset Allocation</h2>
        <p className="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No investable accounts in any plan.
        </p>
      </section>
    );
  }
  const cols = plans.length === 1 ? "grid-cols-1" : plans.length === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Asset Allocation</h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => <PlanColumn key={p.id} plan={p} index={i} mode={mode} />)}
      </div>
    </section>
  );
}
