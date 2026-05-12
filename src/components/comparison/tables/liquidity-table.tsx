"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function LiquidityTableList({ plans }: { plans: ComparisonPlan[] }) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => {
        const rows = plan.liquidityRows;
        if (rows.length === 0) return null;
        const cols = Object.keys(rows[0]).filter((k) => k !== "year");
        return (
          <div key={plan.id}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{plan.label}</div>
            <div className="overflow-auto">
              <table aria-label={`Liquidity — ${plan.label}`} className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Year</th>
                    {cols.map((c) => (
                      <th key={c} className="px-2 py-1 text-right">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.year} className="border-t border-slate-800 text-slate-200">
                      <td className="px-2 py-1">{row.year}</td>
                      {cols.map((c) => (
                        <td key={c} className="px-2 py-1 text-right tabular-nums">
                          {typeof (row as Record<string, unknown>)[c] === "number"
                            ? usd.format((row as Record<string, number>)[c])
                            : String((row as Record<string, unknown>)[c] ?? "—")}
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
