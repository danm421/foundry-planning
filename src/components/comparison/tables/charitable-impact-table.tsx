"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { perYearCharitableFlows } from "@/lib/comparison/charity-flows";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function CharitableImpactTableList({
  plans,
  yearRange,
}: {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}) {
  return (
    <div className="overflow-auto">
      <table
        aria-label="Charitable distribution"
        className="min-w-full border-collapse text-xs"
      >
        <thead>
          <tr className="bg-slate-900/60 text-slate-300">
            <th className="px-2 py-1 text-left">Scenario</th>
            <th className="px-2 py-1 text-right">Lifetime charity</th>
            <th className="px-2 py-1 text-right">Bequests to charity</th>
            <th className="px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => {
            const lifetime = perYearCharitableFlows(plan, yearRange).reduce(
              (s, r) => s + r.total,
              0,
            );
            const bequests = plan.finalEstate?.charity ?? 0;
            return (
              <tr key={plan.id} className="border-t border-slate-800 text-slate-200">
                <td className="px-2 py-1">{plan.label}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {usd.format(lifetime)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {usd.format(bequests)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums font-medium">
                  {usd.format(lifetime + bequests)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
