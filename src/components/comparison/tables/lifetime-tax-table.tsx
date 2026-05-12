"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { LifetimeTaxBuckets } from "@/lib/comparison/lifetime-tax";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const BUCKET_COLUMNS: ReadonlyArray<{ key: keyof LifetimeTaxBuckets; label: string }> = [
  { key: "regularFederalIncomeTax", label: "Federal" },
  { key: "capitalGainsTax", label: "Cap. Gains" },
  { key: "amtAdditional", label: "AMT" },
  { key: "niit", label: "NIIT" },
  { key: "additionalMedicare", label: "Add'l Medicare" },
  { key: "fica", label: "FICA" },
  { key: "stateTax", label: "State" },
];

export function LifetimeTaxTableList({ plans }: { plans: ComparisonPlan[] }) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => {
        // Show only bucket columns that have non-zero values for this plan —
        // mirrors the chart's `visibleKeys` filter so the two views agree.
        const visibleColumns = BUCKET_COLUMNS.filter((col) => {
          if ((plan.lifetime.byBucket[col.key] ?? 0) > 0) return true;
          return plan.result.years.some(
            (y) => (y.taxResult?.flow[col.key] ?? 0) > 0,
          );
        });
        return (
          <div key={plan.id}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
              {plan.label}
            </div>
            <div className="overflow-auto">
              <table
                aria-label={`Lifetime tax — ${plan.label}`}
                className="min-w-full border-collapse text-xs"
              >
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Year</th>
                    {visibleColumns.map((col) => (
                      <th key={col.key} className="px-2 py-1 text-right">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.result.years.map((y) => {
                    const flow = y.taxResult?.flow;
                    const total = flow?.totalTax ?? 0;
                    return (
                      <tr
                        key={y.year}
                        className="border-t border-slate-800 text-slate-200"
                      >
                        <td className="px-2 py-1">{y.year}</td>
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className="px-2 py-1 text-right tabular-nums"
                          >
                            {usd.format(flow?.[col.key] ?? 0)}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right tabular-nums font-medium">
                          {usd.format(total)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-700 bg-slate-900/40 text-slate-100">
                    <td className="px-2 py-1 font-semibold">Lifetime</td>
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className="px-2 py-1 text-right tabular-nums font-semibold"
                      >
                        {usd.format(plan.lifetime.byBucket[col.key] ?? 0)}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">
                      {usd.format(plan.lifetime.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
