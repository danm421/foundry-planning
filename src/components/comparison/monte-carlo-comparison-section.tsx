"use client";

import { FanChart } from "@/components/monte-carlo/fan-chart";
import type { MonteCarloResult, MonteCarloSummary } from "@/engine";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

interface Props {
  plan1Result: MonteCarloResult;
  plan2Result: MonteCarloResult;
  plan1Summary: MonteCarloSummary;
  plan2Summary: MonteCarloSummary;
  plan1Label: string;
  plan2Label: string;
}

export function MonteCarloComparisonSection({
  plan1Result,
  plan2Result,
  plan1Summary,
  plan2Summary,
  plan1Label,
  plan2Label,
}: Props) {
  const successDelta = plan2Result.successRate - plan1Result.successRate;
  const p50Delta = plan2Summary.ending.p50 - plan1Summary.ending.p50;
  const p10Delta = plan2Summary.ending.p20 - plan1Summary.ending.p20;

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Monte Carlo</h2>
      <div className="mb-6 grid grid-cols-3 gap-px bg-slate-800">
        {[
          {
            label: "Success rate",
            a: pct(plan1Result.successRate),
            b: pct(plan2Result.successRate),
            d: `${successDelta >= 0 ? "+" : "−"}${Math.abs(successDelta * 100).toFixed(0)} pts`,
          },
          {
            label: "Median (P50) ending",
            a: usd.format(plan1Summary.ending.p50),
            b: usd.format(plan2Summary.ending.p50),
            d: fmtUsd(p50Delta),
          },
          {
            label: "Lower-tail (P20) ending",
            a: usd.format(plan1Summary.ending.p20),
            b: usd.format(plan2Summary.ending.p20),
            d: fmtUsd(p10Delta),
          },
        ].map((row) => (
          <div key={row.label} className="bg-slate-950 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              {row.label}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
              <div className="text-slate-300">{row.a}</div>
              <div className="text-slate-300">{row.b}</div>
              <div className="font-semibold text-slate-100">{row.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            {plan1Label}
          </div>
          <FanChart
            summary={plan1Summary}
            deterministic={undefined}
            ageMarkers={[]}
            variant="compact"
          />
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            {plan2Label}
          </div>
          <FanChart
            summary={plan2Summary}
            deterministic={undefined}
            ageMarkers={[]}
            variant="compact"
          />
        </div>
      </div>
    </section>
  );
}

function fmtUsd(v: number): string {
  return `${v >= 0 ? "+" : "−"}${usd.format(Math.abs(v))}`;
}
