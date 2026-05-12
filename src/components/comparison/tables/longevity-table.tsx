"use client";

import type { McSharedResult } from "@/lib/comparison/widgets/types";

export function LongevityTableList({ mc }: { mc: McSharedResult }) {
  return (
    <div className="flex flex-col gap-4">
      {mc.perPlan.map((p) => {
        const matrix = p.result.byYearLiquidAssetsPerTrial;
        const yearsPerTrial = matrix[0]?.length ?? 0;
        // For each trial, find the first year where liquid assets fall below threshold
        const failures = matrix.map((trial) => {
          for (let yi = 0; yi < yearsPerTrial; yi++) {
            if ((trial[yi] ?? 0) <= 0) return yi;
          }
          return yearsPerTrial;
        });
        const sorted = [...failures].sort((a, b) => a - b);
        function quantile(q: number) {
          const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
          return sorted[idx] ?? 0;
        }
        const cb = mc.clientBirthYear ?? mc.planStartYear;
        return (
          <div key={p.label}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{p.label}</div>
            <div className="overflow-auto">
              <table aria-label={`Longevity — ${p.label}`} className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-300">
                    <th className="px-2 py-1 text-left">Percentile</th>
                    <th className="px-2 py-1 text-right">Last-funded year</th>
                    <th className="px-2 py-1 text-right">Last-funded age (client)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "10th", q: 0.10 },
                    { label: "50th", q: 0.50 },
                    { label: "90th", q: 0.90 },
                  ].map((r) => {
                    const yi = quantile(r.q);
                    const year = mc.planStartYear + yi;
                    const age = year - cb;
                    return (
                      <tr key={r.label} className="border-t border-slate-800 text-slate-200">
                        <td className="px-2 py-1">{r.label}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{year}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{age}</td>
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
