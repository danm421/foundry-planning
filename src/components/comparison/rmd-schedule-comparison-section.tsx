"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor } from "@/lib/comparison/series-palette";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const STACK_COLORS = ["#2563eb", "#16a34a", "#a855f7", "#f97316", "#facc15", "#22d3ee", "#ef4444"];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function accountIdsWithRmds(years: ProjectionYear[]): string[] {
  const set = new Set<string>();
  for (const y of years) {
    for (const [id, led] of Object.entries(y.accountLedgers ?? {})) {
      if ((led.rmdAmount ?? 0) > 0) set.add(id);
    }
  }
  return [...set];
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function PlanCard({ plan, yearRange, index }: { plan: ComparisonPlan; yearRange: YearRange | null; index: number }) {
  const years = useMemo(() => clip(plan.result.years, yearRange), [plan.result.years, yearRange]);
  const accountIds = useMemo(() => accountIdsWithRmds(years), [years]);

  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: accountIds.map((id, di) => ({
        label: plan.tree.accounts?.find((a) => a.id === id)?.name ?? id,
        data: years.map((y) => y.accountLedgers?.[id]?.rmdAmount ?? 0),
        backgroundColor: STACK_COLORS[di % STACK_COLORS.length],
        stack: "rmd",
      })),
    }),
    [years, accountIds, plan.tree.accounts],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d1d5db", boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: { backgroundColor: "#1f2937" },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
        y: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      },
    }),
    [],
  );

  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      {accountIds.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No RMDs in selected range.</p>
      ) : (
        <div style={{ height: 240 }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}

export function RmdScheduleComparisonSection({ plans, yearRange }: Props) {
  const colsClass =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : plans.length === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">RMD Schedule</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
