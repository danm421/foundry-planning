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
import { chartChrome, dataPalette, useChartColors, useThemeName } from "@/lib/chart-colors";
import type { DataColorKey } from "@/lib/chart-colors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export interface StackedBarSeries {
  label: string;
  /**
   * Stable Deep Jewel palette key, resolved to a theme-aware hex at render.
   * Omit to draw from the brand palette in series order. (Never pass a raw
   * `var(--…)` string — Chart.js paints to canvas, which can't read CSS vars.)
   */
  colorKey?: DataColorKey;
  valueFor: (year: ProjectionYear) => number;
}

interface StackedBarChartProps {
  years: ProjectionYear[];
  series: StackedBarSeries[];
  title?: string;
  height?: number;
}

export function StackedBarChart({ years, series, title, height = 300 }: StackedBarChartProps) {
  const seriesColors = useChartColors();
  const theme = useThemeName();

  const data = useMemo(() => {
    if (years.length === 0 || series.length === 0) return null;
    const palette = seriesColors(series.length);
    const themePalette = dataPalette(theme);
    return {
      labels: years.map((y) => String(y.year)),
      datasets: series.map((s, i) => ({
        label: s.label,
        // Round to whole dollars. Tax/cash-flow values carry sub-dollar
        // floating-point residue; without this the y-axis auto-scales to a
        // fraction of a dollar and amplifies that noise into full-height bars
        // while every gridline rounds to "$0" (see: state-tax chart showing
        // bars with an all-"$0" axis). Whole-dollar rounding matches the axis +
        // tooltip formatter and makes effectively-zero years render as no bar.
        data: years.map((y) => Math.round(s.valueFor(y))),
        backgroundColor: s.colorKey ? themePalette[s.colorKey] : palette[i],
        stack: "main",
      })),
    };
  }, [years, series, seriesColors, theme]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
        title: title
          ? { display: true, text: title, color: chrome.title, font: { size: 14 } }
          : { display: false },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            color: chrome.tick,
            // Integer ticks only — stops an all-zero (or tiny) dataset from
            // generating fractional-dollar gridlines that every render as "$0".
            precision: 0,
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [title, theme]);

  if (!data) return null;
  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  );
}
