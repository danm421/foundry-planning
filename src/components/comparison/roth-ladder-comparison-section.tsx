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
import { chartChrome, chartSeriesColors, useThemeName } from "@/lib/chart-colors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function PlanCard({ plan, yearRange, index }: { plan: ComparisonPlan; yearRange: YearRange | null; index: number }) {
  const theme = useThemeName();
  const stackColors = useMemo(() => chartSeriesColors(7, theme), [theme]);

  const conversionYears = useMemo(
    () =>
      clip(plan.result.years, yearRange).filter(
        (y) => (y.rothConversions?.length ?? 0) > 0,
      ),
    [plan.result.years, yearRange],
  );

  const allNames = useMemo(() => {
    const set = new Set<string>();
    for (const y of conversionYears)
      for (const c of y.rothConversions ?? []) set.add(c.name);
    return [...set];
  }, [conversionYears]);

  const data = useMemo(
    () => ({
      labels: conversionYears.map((y) => String(y.year)),
      datasets: allNames.map((name, di) => ({
        label: name,
        data: conversionYears.map(
          (y) => (y.rothConversions ?? []).filter((c) => c.name === name).reduce((s, c) => s + c.gross, 0),
        ),
        backgroundColor: stackColors[di % stackColors.length],
        stack: "roth",
      })),
    }),
    [conversionYears, allNames, stackColors],
  );

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: chrome.legend, boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            footer: (items: Array<{ dataIndex: number }>) => {
              if (items.length === 0) return "";
              const yr = conversionYears[items[0].dataIndex];
              const taxable = (yr?.rothConversions ?? []).reduce((s, c) => s + c.taxable, 0);
              return taxable > 0 ? `Taxable portion: $${taxable.toLocaleString()}` : "";
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
      },
    };
  }, [theme, conversionYears]);

  const color = seriesColor(index) ?? chartChrome(theme).tick;
  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-ink-3">{plan.label}</span>
      </div>
      {conversionYears.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">No Roth conversions in selected range.</p>
      ) : (
        <div style={{ height: 240 }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}

export function RothLadderComparisonSection({ plans, yearRange }: Props) {
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
      <h2 className="mb-4 text-lg font-semibold text-ink">Roth Conversion Ladder</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
