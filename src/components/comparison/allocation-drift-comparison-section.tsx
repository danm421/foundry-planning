"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor } from "@/lib/comparison/series-palette";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
);

const CATEGORIES: Array<{
  key: keyof ProjectionYear["portfolioAssets"];
  label: string;
  color: string;
}> = [
  { key: "taxableTotal", label: "Taxable", color: "#16a34a" },
  { key: "cashTotal", label: "Cash", color: "#22d3ee" },
  { key: "retirementTotal", label: "Retirement", color: "#2563eb" },
  { key: "realEstateTotal", label: "Real Estate", color: "#a855f7" },
  { key: "businessTotal", label: "Business", color: "#f97316" },
  { key: "lifeInsuranceTotal", label: "Life Insurance", color: "#facc15" },
  { key: "trustsAndBusinessesTotal", label: "Trusts & Businesses", color: "#94a3b8" },
];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function pctSeries(
  years: ProjectionYear[],
  key: keyof ProjectionYear["portfolioAssets"],
): number[] {
  return years.map((y) => {
    const total = y.portfolioAssets.total;
    if (!(total > 0)) return 0;
    return Number((((y.portfolioAssets[key] as number) ?? 0) / total) * 100);
  });
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function MultiYearChart({ years }: { years: ProjectionYear[] }) {
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: CATEGORIES.map((c) => ({
        label: c.label,
        data: pctSeries(years, c.key),
        backgroundColor: c.color + "cc",
        borderColor: c.color,
        fill: true,
        pointRadius: 0,
        tension: 0.2,
        stack: "alloc",
      })),
    }),
    [years],
  );
  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d1d5db", boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          backgroundColor: "#1f2937",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
        y: {
          stacked: true,
          max: 100,
          ticks: { color: "#9ca3af", callback: (v: number | string) => `${v}%` },
          grid: { color: "#1f2937" },
        },
      },
    }),
    [],
  );
  return (
    <div data-test="allocation-drift-area" style={{ height: 240 }}>
      <Line data={data} options={options} />
    </div>
  );
}

function SingleYearBar({ year }: { year: ProjectionYear }) {
  const data = useMemo(() => {
    const total = year.portfolioAssets.total;
    return {
      labels: [String(year.year)],
      datasets: CATEGORIES.map((c) => ({
        label: c.label,
        data: [
          total > 0
            ? Number((((year.portfolioAssets[c.key] as number) ?? 0) / total) * 100)
            : 0,
        ],
        backgroundColor: c.color + "cc",
        borderColor: c.color,
        borderWidth: 1,
        stack: "alloc",
      })),
    };
  }, [year]);
  const options = useMemo(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d1d5db", boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          backgroundColor: "#1f2937",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { x: number } }) =>
              `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          max: 100,
          ticks: { color: "#9ca3af", callback: (v: number | string) => `${v}%` },
          grid: { color: "#1f2937" },
        },
        y: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      },
    }),
    [],
  );
  return (
    <div data-test="allocation-drift-bar" style={{ height: 96 }}>
      <Bar data={data} options={options} />
    </div>
  );
}

function PlanCard({
  plan,
  yearRange,
  index,
}: {
  plan: ComparisonPlan;
  yearRange: YearRange | null;
  index: number;
}) {
  const years = useMemo(
    () => clip(plan.result.years, yearRange),
    [plan.result.years, yearRange],
  );
  const isSingleYear =
    (yearRange != null && yearRange.start === yearRange.end) || years.length === 1;
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      {isSingleYear && years[0] ? (
        <SingleYearBar year={years[0]} />
      ) : (
        <MultiYearChart years={years} />
      )}
    </div>
  );
}

export function AllocationDriftComparisonSection({ plans, yearRange }: Props) {
  const isEmpty = plans.every((p) =>
    clip(p.result.years, yearRange).every((y) => !(y.portfolioAssets.total > 0)),
  );
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
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Asset Allocation Drift</h2>
      {isEmpty ? (
        <p className="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No portfolio data in selected range.
        </p>
      ) : (
        <div className={`grid gap-4 ${colsClass}`}>
          {plans.map((p, i) => (
            <PlanCard key={p.id} plan={p} yearRange={yearRange} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
