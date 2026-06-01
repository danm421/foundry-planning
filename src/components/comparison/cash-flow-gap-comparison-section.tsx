"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight } from "@/brand";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

const MAX_LISTED_GAPS = 6;

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function PlanCard({ plan, yearRange, index }: { plan: ComparisonPlan; yearRange: YearRange | null; index: number }) {
  const theme = useThemeName();
  const years = useMemo(() => clip(plan.result.years, yearRange), [plan.result.years, yearRange]);
  const gapYears = useMemo(
    () => years.filter((y) => y.netCashFlow < 0).map((y) => y.year),
    [years],
  );
  const color = seriesColor(index) ?? chartChrome(theme).tick;

  const data = useMemo(
    () => {
      const red = theme === "light" ? colorsLight.crit : colors.crit;
      return {
        labels: years.map((y) => String(y.year)),
        datasets: [
          {
            label: "Net cash flow",
            data: years.map((y) => y.netCashFlow),
            backgroundColor: years.map((y) => (y.netCashFlow < 0 ? red : color)),
          },
        ],
      };
    },
    [years, color, theme],
  );

  const options = useMemo(
    () => {
      const chrome = chartChrome(theme);
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      };
    },
    [theme],
  );

  const summary =
    gapYears.length === 0
      ? "No gap years in selected range."
      : `${gapYears.length} gap year${gapYears.length === 1 ? "" : "s"}: ${gapYears
          .slice(0, MAX_LISTED_GAPS)
          .join(", ")}${gapYears.length > MAX_LISTED_GAPS ? ` (+${gapYears.length - MAX_LISTED_GAPS} more)` : ""}`;

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-ink-3">{plan.label}</span>
      </div>
      <p className={`mb-3 text-sm ${gapYears.length === 0 ? "text-good" : "text-ink-2"}`}>
        {gapYears.length === 0 ? "✓ " : ""}
        {summary}
      </p>
      <div style={{ height: 60 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function CashFlowGapComparisonSection({ plans, yearRange }: Props) {
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
      <h2 className="mb-4 text-lg font-semibold text-ink">Cash-Flow Gap Years</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
