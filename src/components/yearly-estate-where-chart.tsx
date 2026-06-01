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
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  rows: YearlyEstateRow[];
}

export function YearlyEstateWhereChart({ rows }: Props) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (rows.length === 0) return null;
    const c = theme === "light" ? colorsLight : colors;
    const palette = theme === "light" ? brandDataLight : brandData;
    return {
      labels: rows.map((r) => String(r.year)),
      datasets: [
        {
          label: "Net to Heirs",
          data: rows.map((r) => r.netToHeirs),
          backgroundColor: c.good,
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "Taxes & Expenses",
          data: rows.map((r) => r.taxesAndExpenses),
          backgroundColor: c.crit,
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "Charitable Bequests",
          data: rows.map((r) => r.charitableBequests),
          backgroundColor: palette.yellow,
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [rows, theme]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
          labels: { color: chrome.legend, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          mode: "index" as const,
          intersect: false,
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
        x: {
          stacked: true,
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: true,
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);

  if (!chartData) return null;

  return (
    <div style={{ height: 280 }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}
