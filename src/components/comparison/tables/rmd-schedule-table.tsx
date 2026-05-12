"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import type { ProjectionYear } from "@/engine";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function totalRmd(y: ProjectionYear): number {
  let total = 0;
  for (const led of Object.values(y.accountLedgers ?? {})) {
    total += led.rmdAmount ?? 0;
  }
  return total;
}

export function RmdScheduleTableList({
  plans,
  yearRange,
}: {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => (
        <div key={plan.id}>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            {plan.label}
          </div>
          <div className="overflow-auto">
            <table
              aria-label={`RMD schedule — ${plan.label}`}
              className="min-w-full border-collapse text-xs"
            >
              <thead>
                <tr className="bg-slate-900/60 text-slate-300">
                  <th className="px-2 py-1 text-left">Year</th>
                  <th className="px-2 py-1 text-right">RMD total</th>
                </tr>
              </thead>
              <tbody>
                {clip(plan.result.years, yearRange)
                  .filter((y) => totalRmd(y) > 0)
                  .map((y) => (
                    <tr
                      key={y.year}
                      className="border-t border-slate-800 text-slate-200"
                    >
                      <td className="px-2 py-1">{y.year}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {usd.format(totalRmd(y))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
