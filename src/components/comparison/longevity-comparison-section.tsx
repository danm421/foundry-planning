"use client";

import { LongevityChart } from "@/components/monte-carlo/longevity-chart";
import { successByYear } from "@/lib/comparison/success-by-year";
import { seriesColor } from "@/lib/comparison/series-palette";

function lastYearAtThreshold(
  rates: number[],
  threshold: number,
  planStartYear: number,
): number | undefined {
  for (let i = rates.length - 1; i >= 0; i--) {
    if (rates[i] >= threshold) return planStartYear + i;
  }
  return undefined;
}

export interface PlanLongevity {
  label: string;
  matrix: number[][];
}

interface Props {
  plans: PlanLongevity[];
  threshold: number;
  planStartYear: number;
  clientBirthYear?: number;
}

export function LongevityComparisonSection({
  plans,
  threshold,
  planStartYear,
  clientBirthYear,
}: Props) {
  const perPlan = plans.map((p) => ({
    label: p.label,
    matrix: p.matrix,
    last90: lastYearAtThreshold(
      successByYear(p.matrix, threshold),
      0.9,
      planStartYear,
    ),
  }));

  return (
    <section className="px-6 py-8">
      <h2 className="mb-2 text-lg font-semibold text-slate-100">Longevity</h2>
      <div
        className="mb-4 grid gap-2 text-sm text-slate-400"
        style={{
          gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))`,
        }}
      >
        {perPlan.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: seriesColor(i) }}
              aria-hidden
            />
            <span>
              <span className="text-slate-200">{p.label}</span> stays ≥ 90%
              through {p.last90 ?? "—"}
            </span>
          </div>
        ))}
      </div>
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(plans.length, 2)}, minmax(0, 1fr))`,
        }}
      >
        {perPlan.map((p, i) => (
          <div key={i}>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
              {p.label}
            </div>
            <LongevityChart
              byYearLiquidAssetsPerTrial={p.matrix}
              requiredMinimumAssetLevel={threshold}
              planStartYear={planStartYear}
              clientBirthYear={clientBirthYear}
              variant="compact"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
