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

const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Props {
  years: ProjectionYear[];
}

export default function PortfolioGrowthChart({ years }: Props) {
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        {
          label: "Portfolio assets",
          data: years.map((y) => y.portfolioAssets.total),
          backgroundColor: "#2563eb",
          borderRadius: 2,
        },
      ],
    }),
    [years],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { raw: unknown }) =>
              `Portfolio assets: ${fmtFull.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => fmtCompact.format(Number(value)),
          },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
      },
    }),
    [],
  );

  if (years.length === 0) return null;
  return (
    <div style={{ height: 260 }}>
      <Bar data={data} options={options} />
    </div>
  );
}
