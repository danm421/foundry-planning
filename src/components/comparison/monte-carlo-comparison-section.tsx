"use client";

import { FanChart } from "@/components/monte-carlo/fan-chart";
import { SuccessGauge } from "@/components/monte-carlo/success-gauge";
import { seriesColor } from "@/lib/comparison/series-palette";
import type { MonteCarloResult, MonteCarloSummary } from "@/engine";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
function fmtPtsDelta(v: number): string {
  const pts = v * 100;
  if (pts === 0) return "0 pts";
  return `${pts < 0 ? "−" : "+"}${Math.abs(pts).toFixed(0)} pts`;
}

export interface PlanMcData {
  planId: string;
  label: string;
  successRate: number;
  result: MonteCarloResult;
  summary: MonteCarloSummary;
}

interface Props {
  plansMc: PlanMcData[];
}

export function MonteCarloComparisonSection({ plansMc }: Props) {
  const base = plansMc[0];
  const colsClass =
    plansMc.length === 1
      ? "grid-cols-1"
      : plansMc.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : plansMc.length === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Monte Carlo</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plansMc.map((p, i) => {
          const delta = i === 0 ? 0 : p.successRate - base.successRate;
          const color = seriesColor(i) ?? "#cbd5e1";
          return (
            <div
              key={i}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {p.label}
                </span>
                {i === 0 && (
                  <span className="rounded border border-slate-700 px-1 text-[10px] uppercase text-slate-400">
                    Baseline
                  </span>
                )}
              </div>
              <div className="mb-3 flex items-end gap-3">
                <SuccessGauge value={p.successRate} />
                <div className="pb-2">
                  <div className="text-2xl font-semibold text-slate-100">
                    {pct(p.successRate)}
                  </div>
                  <div className="text-xs text-slate-400">
                    probability of success
                  </div>
                  {i !== 0 && (
                    <div
                      className={`mt-1 text-xs font-semibold ${
                        delta > 0
                          ? "text-emerald-400"
                          : delta < 0
                            ? "text-rose-400"
                            : "text-slate-400"
                      }`}
                    >
                      {fmtPtsDelta(delta)} vs baseline
                    </div>
                  )}
                </div>
              </div>
              <FanChart
                summary={p.summary}
                deterministic={undefined}
                ageMarkers={[]}
                variant="compact"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
