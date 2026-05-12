"use client";

import type { McSharedResult } from "@/lib/comparison/widgets/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function MonteCarloTableList({ mc }: { mc: McSharedResult }) {
  return (
    <div className="flex flex-col gap-4">
      {mc.perPlan.map((p) => {
        const years = p.result.byYearLiquidAssetsPerTrial[0]?.length ?? 0;
        const startYear = mc.planStartYear;
        const matrix = p.result.byYearLiquidAssetsPerTrial; // trials × years
        // Compute p10/p50/p90 per year
        function percentile(values: number[], q: number) {
          const sorted = [...values].sort((a, b) => a - b);
          const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
          return sorted[idx] ?? 0;
        }
        return (
          <div key={p.label}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{p.label}</div>
            <div className="overflow-auto">
              <table aria-label={`Monte Carlo — ${p.label}`} className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Year</th>
                    <th className="px-2 py-1 text-right">10th %ile</th>
                    <th className="px-2 py-1 text-right">50th %ile</th>
                    <th className="px-2 py-1 text-right">90th %ile</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: years }, (_, yi) => {
                    const yearValues = matrix.map((trial) => trial[yi]);
                    return (
                      <tr key={yi} className="border-t border-slate-800 text-slate-200">
                        <td className="px-2 py-1">{startYear + yi}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{usd.format(percentile(yearValues, 0.10))}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{usd.format(percentile(yearValues, 0.50))}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{usd.format(percentile(yearValues, 0.90))}</td>
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
