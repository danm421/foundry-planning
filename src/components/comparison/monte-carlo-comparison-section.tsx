"use client";

import { FanChart } from "@/components/monte-carlo/fan-chart";
import { SuccessGauge } from "@/components/monte-carlo/success-gauge";
import { seriesColor } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
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
  const theme = useThemeName();
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
      <h2 className="mb-4 text-lg font-semibold text-ink">Monte Carlo</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plansMc.map((p, i) => {
          const delta = i === 0 ? 0 : p.successRate - base.successRate;
          const color = seriesColor(i) ?? chartChrome(theme).tick;
          return (
            <div
              key={i}
              className="rounded-lg border border-hair bg-card p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="text-xs uppercase tracking-wide text-ink-3">
                  {p.label}
                </span>
                {i === 0 && (
                  <span className="rounded border border-hair px-1 text-[10px] uppercase text-ink-3">
                    Baseline
                  </span>
                )}
              </div>
              <div className="mb-3 flex items-end gap-3">
                <SuccessGauge value={p.successRate} />
                <div className="pb-2">
                  <div className="text-2xl font-semibold text-ink">
                    {pct(p.successRate)}
                  </div>
                  <div className="text-xs text-ink-3">
                    probability of success
                  </div>
                  {i !== 0 && (
                    <div
                      className={`mt-1 text-xs font-semibold ${
                        delta > 0
                          ? "text-good"
                          : delta < 0
                            ? "text-crit"
                            : "text-ink-3"
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
