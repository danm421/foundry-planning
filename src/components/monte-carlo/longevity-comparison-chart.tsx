"use client";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Tooltip, Legend,
} from "chart.js";
import { successByYear } from "@/lib/comparison/success-by-year";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  plan1Matrix: number[][];
  plan2Matrix: number[][];
  threshold: number;
  planStartYear: number;
  plan1Label: string;
  plan2Label: string;
}

export function LongevityComparisonChart({
  plan1Matrix, plan2Matrix, threshold, planStartYear, plan1Label, plan2Label,
}: Props) {
  const plan1Pct = successByYear(plan1Matrix, threshold).map((r) => r * 100);
  const plan2Pct = successByYear(plan2Matrix, threshold).map((r) => r * 100);
  const labels = plan1Pct.map((_, i) => planStartYear + i);

  const data = {
    labels,
    datasets: [
      {
        label: plan1Label,
        data: plan1Pct,
        borderColor: "#60a5fa",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      },
      {
        label: plan2Label,
        data: plan2Pct,
        borderColor: "#f97316",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { position: "top" as const, labels: { color: "#cbd5e1" } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(0)}%`,
          afterBody: (items: Array<{ parsed: { y: number } }>) => {
            if (items.length < 2) return "";
            const delta = items[1].parsed.y - items[0].parsed.y;
            const sign = delta >= 0 ? "+" : "";
            return `Δ: ${sign}${delta.toFixed(0)} pts`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
      y: {
        min: 0, max: 100,
        ticks: { color: "#94a3b8", callback: (v: number | string) => `${v}%` },
        grid: { color: "rgba(148, 163, 184, 0.15)" },
      },
    },
  };

  return (
    <div className="h-72 w-full">
      <Line data={data} options={options} />
    </div>
  );
}
