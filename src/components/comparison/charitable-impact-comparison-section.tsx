"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor, seriesDash } from "@/lib/comparison/series-palette";
import {
  perYearCharitableFlows,
  charityCarryforwardTotal,
} from "@/lib/comparison/charity-flows";
import { chartChrome, useThemeName } from "@/lib/chart-colors";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const fmtMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

export function CharitableImpactComparisonSection({ plans, yearRange }: Props) {
  const theme = useThemeName();

  const perPlan = useMemo(
    () => plans.map((p) => perYearCharitableFlows(p, yearRange)),
    [plans, yearRange],
  );

  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const rows of perPlan) for (const r of rows) set.add(r.year);
    return [...set].sort((a, b) => a - b);
  }, [perPlan]);

  const lifetimeTotals = useMemo(
    () => perPlan.map((rows) => rows.reduce((s, r) => s + r.total, 0)),
    [perPlan],
  );

  const remainingCarryforward = useMemo(
    () =>
      plans.map((p) => {
        const inRange = yearRange
          ? p.result.years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end)
          : p.result.years;
        const last = inRange[inRange.length - 1];
        return charityCarryforwardTotal(last?.charityCarryforward);
      }),
    [plans, yearRange],
  );

  const isEmpty = lifetimeTotals.every((t) => t === 0);

  const data = useMemo(
    () => {
      const chrome = chartChrome(theme);
      return {
        labels: allYears.map(String),
        datasets: plans.map((p, i) => {
          const rowMap = new Map(perPlan[i].map((r) => [r.year, r.total]));
          return {
            label: p.label,
            data: allYears.map((yr) => rowMap.get(yr) ?? 0),
            borderColor: seriesColor(i) ?? chrome.tick,
            backgroundColor: seriesColor(i) ?? chrome.tick,
            borderDash: [...(seriesDash(i) ?? [])],
            tension: 0.2,
            pointRadius: 0,
          };
        }),
      };
    },
    [plans, allYears, perPlan, theme],
  );

  const options = useMemo(
    () => {
      const chrome = chartChrome(theme);
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: chrome.legend } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
          },
        },
        scales: {
          x: { ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
          y: { ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        },
      };
    },
    [theme],
  );

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-ink">Charitable Impact</h2>
      {isEmpty ? (
        <p className="rounded border border-hair bg-card p-6 text-sm text-ink-3">
          No charitable outflows in selected range.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-hair bg-card p-4" style={{ height: 280 }}>
            <Line data={data} options={options} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => {
              const color = seriesColor(i) ?? chartChrome(theme).tick;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-hair bg-card p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                    <span className="text-xs uppercase tracking-wide text-ink-3">{p.label}</span>
                  </div>
                  <div className="text-base font-medium text-ink">
                    {fmtMoney.format(lifetimeTotals[i])}
                  </div>
                  <div className="text-xs text-ink-3">
                    Carryforward: {fmtMoney.format(remainingCarryforward[i])}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
