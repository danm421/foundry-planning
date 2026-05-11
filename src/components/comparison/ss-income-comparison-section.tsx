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
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor, seriesDash } from "@/lib/comparison/series-palette";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const fmtMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

export function SsIncomeComparisonSection({ plans, yearRange }: Props) {
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const p of plans) for (const y of clip(p.result.years, yearRange)) set.add(y.year);
    return [...set].sort((a, b) => a - b);
  }, [plans, yearRange]);

  const lifetimeTotals = useMemo(
    () =>
      plans.map((p) =>
        clip(p.result.years, yearRange).reduce((s, y) => s + y.income.socialSecurity, 0),
      ),
    [plans, yearRange],
  );

  const isEmpty = lifetimeTotals.every((t) => t === 0);

  const data = useMemo(
    () => ({
      labels: allYears.map(String),
      datasets: plans.map((p, i) => {
        const yMap = new Map(p.result.years.map((y) => [y.year, y.income.socialSecurity]));
        return {
          label: p.label,
          data: allYears.map((yr) => yMap.get(yr) ?? 0),
          borderColor: seriesColor(i) ?? "#cbd5e1",
          backgroundColor: seriesColor(i) ?? "#cbd5e1",
          borderDash: [...(seriesDash(i) ?? [])],
          tension: 0.2,
          pointRadius: 0,
        };
      }),
    }),
    [plans, allYears],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d1d5db" } },
        tooltip: { backgroundColor: "#1f2937" },
      },
      scales: {
        x: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
        y: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      },
    }),
    [],
  );

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Social Security Income</h2>
      {isEmpty ? (
        <p className="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No Social Security income in selected range.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4" style={{ height: 280 }}>
            <Line data={data} options={options} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => {
              const total = lifetimeTotals[i];
              const delta = i === 0 ? null : total - lifetimeTotals[0];
              const color = seriesColor(i) ?? "#cbd5e1";
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                    <span className="text-xs uppercase tracking-wide text-slate-400">{p.label}</span>
                  </div>
                  <div className="text-base font-medium text-slate-100">{fmtMoney.format(total)}</div>
                  {delta != null && (
                    <div className={`text-xs ${delta < 0 ? "text-rose-400" : delta > 0 ? "text-emerald-400" : "text-slate-400"}`}>
                      {delta === 0 ? "$0" : `${delta < 0 ? "−" : "+"}${fmtMoney.format(Math.abs(delta))}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
