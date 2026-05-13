"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor } from "@/lib/comparison/series-palette";
import { buildTaxBracketRows } from "@/lib/reports/tax-bracket";
import {
  bracketTopsByYear,
  inferOrdinaryBrackets,
  sliceIntoBrackets,
} from "@/lib/comparison/bracket-fill";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const RATE_COLOR: Record<string, string> = {
  "0.10": "#16a34a",
  "0.12": "#2563eb",
  "0.22": "#22d3ee",
  "0.24": "#facc15",
  "0.32": "#f97316",
  "0.35": "#ef4444",
  "0.37": "#a855f7",
};
function rateColor(rate: number): string {
  return RATE_COLOR[rate.toFixed(2)] ?? "#94a3b8";
}
function rateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function PlanCard({ plan, yearRange, index }: { plan: ComparisonPlan; yearRange: YearRange | null; index: number }) {
  const years = useMemo(() => clip(plan.result.years, yearRange), [plan.result.years, yearRange]);
  const rows = useMemo(() => buildTaxBracketRows(years), [years]);

  const allRates = useMemo(() => {
    const set = new Set<number>();
    for (const y of years) {
      const tr = y.taxResult;
      if (!tr) continue;
      const brackets = inferOrdinaryBrackets(tr.diag.marginalBracketTier, tr.diag.bracketsUsed);
      for (const t of brackets) set.add(t.rate);
    }
    return [...set].sort((a, b) => a - b);
  }, [years]);

  const bracketTops = useMemo(() => bracketTopsByYear(years), [years]);

  const data = useMemo(() => {
    const labels = rows.map((r) => String(r.year));
    const yearMeta = years.map((y) => {
      const tr = y.taxResult;
      if (!tr) return { brackets: [], slices: [] as Array<{ rate: number; amount: number }> };
      const brackets = inferOrdinaryBrackets(tr.diag.marginalBracketTier, tr.diag.bracketsUsed);
      const slices = sliceIntoBrackets(tr.flow.incomeTaxBase, brackets);
      return { brackets, slices };
    });
    const barDatasets = allRates.map((rate) => ({
      label: rateLabel(rate),
      data: yearMeta.map((m) => m.slices.find((s) => s.rate === rate)?.amount ?? 0),
      backgroundColor: rateColor(rate),
      stack: "tbf",
    }));
    const lineDatasets = Array.from(bracketTops.entries()).map(([rate, series]) => ({
      type: "line" as const,
      label: `Top of ${rateLabel(rate)}`,
      data: series,
      borderColor: rateColor(rate) + "cc",
      backgroundColor: "transparent",
      borderWidth: 1,
      borderDash: [4, 4] as [number, number],
      pointRadius: 0,
      stepped: "before" as const,
      fill: false,
      // Each line in its own stack — y.stacked=true is needed for the bar
      // datasets, but without a unique stack key Chart.js groups all lines
      // by their type and renders them as a cumulative stacked area.
      stack: `bracket-top-${rate}`,
    }));
    return { labels, datasets: [...barDatasets, ...lineDatasets] };
  }, [years, rows, allRates, bracketTops]);

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
      <div style={{ height: 240 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function TaxBracketFillComparisonSection({ plans, yearRange }: Props) {
  const isEmpty = plans.every((p) =>
    clip(p.result.years, yearRange).every((y) => !y.taxResult || y.taxResult.flow.incomeTaxBase <= 0),
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
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Tax Bracket Fill</h2>
      {isEmpty ? (
        <p className="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No taxable income in selected range.
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
