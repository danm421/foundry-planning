"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import type { ProjectionYear } from "@/engine";
import {
  buildAccountSourceMap,
  SOURCE_LABELS,
  SOURCE_ORDER,
  type WithdrawalSourceCategory,
} from "@/lib/comparison/withdrawal-categories";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function categoryTotals(
  year: ProjectionYear,
  sourceMap: Record<string, WithdrawalSourceCategory>,
): Record<WithdrawalSourceCategory, number> {
  const totals = Object.fromEntries(
    SOURCE_ORDER.map((k) => [k, 0]),
  ) as Record<WithdrawalSourceCategory, number>;
  totals["social-security"] += year.income?.socialSecurity ?? 0;
  totals.pension += year.income?.deferred ?? 0;
  const byAccount = year.withdrawals?.byAccount ?? {};
  for (const [accId, amt] of Object.entries(byAccount)) {
    const cat = sourceMap[accId] ?? "other";
    totals[cat] += amt;
  }
  return totals;
}

export function WithdrawalSourceTableList({
  plans,
  yearRange,
}: {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => {
        const sourceMap = buildAccountSourceMap(plan.tree?.accounts ?? []);
        const years = clip(plan.result.years, yearRange);
        return (
          <div key={plan.id}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
              {plan.label}
            </div>
            <div className="overflow-auto">
              <table
                aria-label={`Withdrawals — ${plan.label}`}
                className="min-w-full border-collapse text-xs"
              >
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Year</th>
                    {SOURCE_ORDER.map((cat) => (
                      <th key={cat} className="px-2 py-1 text-right">
                        {SOURCE_LABELS[cat]}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const totals = categoryTotals(y, sourceMap);
                    const rowTotal = SOURCE_ORDER.reduce(
                      (sum, cat) => sum + totals[cat],
                      0,
                    );
                    return (
                      <tr
                        key={y.year}
                        className="border-t border-slate-800 text-slate-200"
                      >
                        <td className="px-2 py-1">{y.year}</td>
                        {SOURCE_ORDER.map((cat) => (
                          <td
                            key={cat}
                            className="px-2 py-1 text-right tabular-nums"
                          >
                            {usd.format(totals[cat])}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right tabular-nums font-medium">
                          {usd.format(rowTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
