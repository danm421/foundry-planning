"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import type { ProjectionYear } from "@/engine";
import { inferOrdinaryBrackets, sliceIntoBrackets } from "@/lib/comparison/bracket-fill";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (r: number) => `${Math.round(r * 100)}%`;

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

export function TaxBracketFillTableList({ plans, yearRange }: { plans: ComparisonPlan[]; yearRange: YearRange | null }) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => {
        const years = clip(plan.result.years, yearRange);
        const rateSet = new Set<number>();
        const rows = years.map((y) => {
          const tr = y.taxResult;
          if (!tr) return { year: y.year, byRate: new Map<number, number>() };
          const brackets = inferOrdinaryBrackets(tr.diag.marginalBracketTier, tr.diag.bracketsUsed);
          const slices = sliceIntoBrackets(tr.flow.incomeTaxBase, brackets);
          const byRate = new Map<number, number>();
          for (const s of slices) {
            byRate.set(s.rate, s.amount);
            rateSet.add(s.rate);
          }
          return { year: y.year, byRate };
        });
        const rates = [...rateSet].sort((a, b) => a - b);
        return (
          <div key={plan.id}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{plan.label}</div>
            <div className="overflow-auto">
              <table aria-label={`Tax brackets — ${plan.label}`} className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Year</th>
                    {rates.map((r) => (
                      <th key={r} className="px-2 py-1 text-right">{pct(r)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.year} className="border-t border-slate-800 text-slate-200">
                      <td className="px-2 py-1">{row.year}</td>
                      {rates.map((r) => (
                        <td key={r} className="px-2 py-1 text-right tabular-nums">
                          {row.byRate.has(r) ? usd.format(row.byRate.get(r) as number) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
