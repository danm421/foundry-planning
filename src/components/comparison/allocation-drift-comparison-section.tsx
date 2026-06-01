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
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import { data } from "@/brand";

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

// 7 asset categories — mapped to adjacency-ordered Deep Jewel hues so neighbors
// stay in distinct hue families.
// orange→green→yellow→teal→pink→blue→grey covers 7 distinct hue families.
const CATEGORY_KEYS: Array<{
  key: keyof ProjectionYear["portfolioAssets"];
  label: string;
  hue: keyof typeof data;
}> = [
  { key: "taxableTotal",          label: "Taxable",             hue: "orange" },
  { key: "cashTotal",             label: "Cash",                hue: "green"  },
  { key: "retirementTotal",       label: "Retirement",          hue: "yellow" },
  { key: "realEstateTotal",       label: "Real Estate",         hue: "teal"   },
  { key: "businessTotal",         label: "Business",            hue: "pink"   },
  { key: "lifeInsuranceTotal",    label: "Life Insurance",      hue: "blue"   },
  { key: "trustsAndBusinessesTotal", label: "Trusts & Businesses", hue: "grey" },
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

function MultiYearChart({ years, theme }: { years: ProjectionYear[]; theme: "dark" | "light" }) {
  const palette = dataPalette(theme);
  const data_ = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: CATEGORY_KEYS.map((c) => {
        const hex = palette[c.hue];
        return {
          label: c.label,
          data: pctSeries(years, c.key),
          backgroundColor: hex + "cc",
          borderColor: hex,
          fill: true,
          pointRadius: 0,
          tension: 0.2,
          stack: "alloc",
        };
      }),
    }),
    [years, palette],
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
            label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
              `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: {
          stacked: true,
          max: 100,
          ticks: { color: chrome.tick, callback: (v: number | string) => `${v}%` },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);
  return (
    <div data-test="allocation-drift-area" style={{ height: 240 }}>
      <Line data={data_} options={options} />
    </div>
  );
}

function SingleYearBar({ year, theme }: { year: ProjectionYear; theme: "dark" | "light" }) {
  const palette = dataPalette(theme);
  const data_ = useMemo(() => {
    const total = year.portfolioAssets.total;
    return {
      labels: [String(year.year)],
      datasets: CATEGORY_KEYS.map((c) => {
        const hex = palette[c.hue];
        return {
          label: c.label,
          data: [
            total > 0
              ? Number((((year.portfolioAssets[c.key] as number) ?? 0) / total) * 100)
              : 0,
          ],
          backgroundColor: hex + "cc",
          borderColor: hex,
          borderWidth: 1,
          stack: "alloc",
        };
      }),
    };
  }, [year, palette]);
  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: chrome.legend, boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { x: number | null } }) =>
              `${ctx.dataset.label}: ${(ctx.parsed.x ?? 0).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          max: 100,
          ticks: { color: chrome.tick, callback: (v: number | string) => `${v}%` },
          grid: { color: chrome.grid },
        },
        y: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);
  return (
    <div data-test="allocation-drift-bar" style={{ height: 96 }}>
      <Bar data={data_} options={options} />
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
  const theme = useThemeName();
  const color = seriesColor(index) ?? chartChrome(theme).tick;
  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-ink-3">{plan.label}</span>
      </div>
      {isSingleYear && years[0] ? (
        <SingleYearBar year={years[0]} theme={theme} />
      ) : (
        <MultiYearChart years={years} theme={theme} />
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
      <h2 className="mb-4 text-lg font-semibold text-ink">Asset Allocation Drift</h2>
      {isEmpty ? (
        <p className="rounded border border-hair bg-card p-6 text-sm text-ink-3">
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
