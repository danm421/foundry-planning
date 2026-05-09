"use client";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Tooltip, Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import type { ProjectionYear } from "@/engine/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface Props {
  plan1Years: ProjectionYear[];
  plan2Years: ProjectionYear[];
  plan1Label: string;
  plan2Label: string;
}

export function PortfolioOverlayChart({ plan1Years, plan2Years, plan1Label, plan2Label }: Props) {
  const labels = plan1Years.map((y) => y.year);
  const plan1Totals = plan1Years.map((y) => y.portfolioAssets?.total ?? 0);
  const plan2Totals = plan2Years.map((y) => y.portfolioAssets?.total ?? 0);

  const data = {
    labels,
    datasets: [
      {
        label: plan1Label,
        data: plan1Totals,
        borderColor: "#60a5fa",
        backgroundColor: "rgba(96, 165, 250, 0.05)",
        borderWidth: 2,
        pointRadius: 0,
      },
      {
        label: plan2Label,
        data: plan2Totals,
        borderColor: "#f97316",
        backgroundColor: "rgba(249, 115, 22, 0.05)",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
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
          label: (ctx: TooltipItem<"line">) =>
            `${ctx.dataset.label}: ${usd.format(ctx.parsed.y ?? 0)}`,
          afterBody: (items: TooltipItem<"line">[]) => {
            if (items.length < 2) return "";
            const delta = (items[1].parsed.y ?? 0) - (items[0].parsed.y ?? 0);
            const sign = delta >= 0 ? "+" : "";
            return `Δ: ${sign}${usd.format(delta)}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
      y: {
        ticks: { color: "#94a3b8", callback: (v: number | string) => usd.format(Number(v)) },
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
