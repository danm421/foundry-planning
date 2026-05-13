"use client";

import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Portfolio Assets = liquid investable buckets only. Real estate, business,
// and entity/trust-owned shares belong on the balance sheet, not here.
const COLUMNS: Array<{ key: keyof ProjectionYear["portfolioAssets"]; label: string }> = [
  { key: "cashTotal",          label: "Cash" },
  { key: "taxableTotal",       label: "Taxable" },
  { key: "retirementTotal",    label: "Retirement" },
  { key: "lifeInsuranceTotal", label: "Life Insurance" },
];

export function PortfolioTableList({ plans }: { plans: ComparisonPlan[] }) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => (
        <div key={plan.id}>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{plan.label}</div>
          <div className="overflow-auto">
            <table aria-label={`Portfolio — ${plan.label}`} className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/60 text-slate-300">
                  <th className="px-2 py-1 text-left">Year</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-1 text-right">{c.label}</th>
                  ))}
                  <th className="px-2 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {plan.result.years.map((y) => {
                  const total = COLUMNS.reduce(
                    (sum, c) => sum + ((y.portfolioAssets[c.key] as number) ?? 0),
                    0,
                  );
                  return (
                    <tr key={y.year} className="border-t border-slate-800 text-slate-200">
                      <td className="px-2 py-1">{y.year}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-2 py-1 text-right tabular-nums">
                          {usd.format((y.portfolioAssets[c.key] as number) ?? 0)}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">
                        {usd.format(total)}
                      </td>
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
