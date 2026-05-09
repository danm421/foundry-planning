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

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export interface StackedBarSeries {
  label: string;
  color: string;
  valueFor: (year: ProjectionYear) => number;
}

interface StackedBarChartProps {
  years: ProjectionYear[];
  series: StackedBarSeries[];
  title?: string;
  height?: number;
}

export function StackedBarChart({ years, series, title, height = 300 }: StackedBarChartProps) {
  const data = useMemo(() => {
    if (years.length === 0 || series.length === 0) return null;
    return {
      labels: years.map((y) => String(y.year)),
      datasets: series.map((s) => ({
        label: s.label,
        data: years.map(s.valueFor),
        backgroundColor: s.color,
        stack: "main",
      })),
    };
  }, [years, series]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: "#d1d5db", boxWidth: 12, padding: 16 } },
        title: title
          ? { display: true, text: title, color: "#f3f4f6", font: { size: 14 } }
          : { display: false },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
        y: {
          stacked: true,
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: "#374151" },
        },
      },
    }),
    [title],
  );

  if (!data) return null;
  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  );
}
