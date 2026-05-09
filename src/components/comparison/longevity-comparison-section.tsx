"use client";

import { LongevityComparisonChart } from "@/components/monte-carlo/longevity-comparison-chart";
import { successByYear } from "@/lib/comparison/success-by-year";

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

interface Props {
  plan1Matrix: number[][];
  plan2Matrix: number[][];
  threshold: number;
  planStartYear: number;
  plan1Label: string;
  plan2Label: string;
}

export function LongevityComparisonSection(props: Props) {
  const r1 = successByYear(props.plan1Matrix, props.threshold);
  const r2 = successByYear(props.plan2Matrix, props.threshold);
  const last90Plan1 = lastYearAtThreshold(r1, 0.9, props.planStartYear);
  const last90Plan2 = lastYearAtThreshold(r2, 0.9, props.planStartYear);

  return (
    <section className="px-6 py-8">
      <h2 className="mb-2 text-lg font-semibold text-slate-100">Longevity</h2>
      <div className="mb-4 text-sm text-slate-400">
        {props.plan1Label} stays ≥ 90% through {last90Plan1 ?? "—"} ·{" "}
        {props.plan2Label} stays ≥ 90% through {last90Plan2 ?? "—"}
      </div>
      <LongevityComparisonChart
        plan1Matrix={props.plan1Matrix}
        plan2Matrix={props.plan2Matrix}
        threshold={props.threshold}
        planStartYear={props.planStartYear}
        plan1Label={props.plan1Label}
        plan2Label={props.plan2Label}
      />
    </section>
  );
}
