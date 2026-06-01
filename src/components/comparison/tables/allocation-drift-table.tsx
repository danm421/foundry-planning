"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import type { ProjectionYear } from "@/engine";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const CATEGORIES: Array<{ key: keyof ProjectionYear["portfolioAssets"]; label: string }> = [
  { key: "taxableTotal",             label: "Taxable" },
  { key: "cashTotal",                label: "Cash" },
  { key: "retirementTotal",          label: "Retirement" },
  { key: "realEstateTotal",          label: "Real Estate" },
  { key: "businessTotal",            label: "Business" },
  { key: "lifeInsuranceTotal",       label: "Life Insurance" },
  { key: "trustsAndBusinessesTotal", label: "Trusts & Bus." },
];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

export function AllocationDriftTableList({ plans, yearRange }: { plans: ComparisonPlan[]; yearRange: YearRange | null }) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => (
        <div key={plan.id}>
          <div className="mb-1 text-xs uppercase tracking-wide text-ink-3">{plan.label}</div>
          <div className="overflow-auto">
            <table aria-label={`Allocation drift — ${plan.label}`} className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-card-2 text-ink-2">
                  <th className="px-2 py-1 text-left">Year</th>
                  {CATEGORIES.map((c) => (
                    <th key={c.key} className="px-2 py-1 text-right">{c.label}</th>
                  ))}
                  <th className="px-2 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {clip(plan.result.years, yearRange).map((y) => {
                  const total = y.portfolioAssets.total;
                  return (
                    <tr key={y.year} className="border-t border-hair text-ink">
                      <td className="px-2 py-1">{y.year}</td>
                      {CATEGORIES.map((c) => {
                        const v = (y.portfolioAssets[c.key] as number) ?? 0;
                        const p = total > 0 ? (v / total) * 100 : 0;
                        return (
                          <td key={c.key} className="px-2 py-1 text-right tabular-nums">
                            {usd.format(v)} <span className="text-ink-3">({p.toFixed(1)}%)</span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{usd.format(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
