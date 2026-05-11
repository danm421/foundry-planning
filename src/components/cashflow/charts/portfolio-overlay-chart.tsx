"use client";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import type { ProjectionYear } from "@/engine/types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Investable portfolio total — matches the cashflow report's `liquidPortfolioTotal`.
// Excludes real estate, business, and out-of-estate trust assets so the chart
// reflects what advisors mean by "portfolio" in the cashflow context.
function liquidPortfolioTotal(y: ProjectionYear): number {
  return (
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal +
    y.portfolioAssets.lifeInsuranceTotal
  );
}

interface Props {
  plan1Years: ProjectionYear[];
  plan2Years: ProjectionYear[];
  plan1Label: string;
  plan2Label: string;
}

export function PortfolioOverlayChart({ plan1Years, plan2Years, plan1Label, plan2Label }: Props) {
  const labels = plan2Years.map((y) => y.year);

  const plan1ByYear = new Map<number, number>();
  for (const y of plan1Years) plan1ByYear.set(y.year, liquidPortfolioTotal(y));

  const floor: number[] = [];
  const plan2Ahead: number[] = [];
  const plan1Ahead: number[] = [];
  for (const y of plan2Years) {
    const plan2 = liquidPortfolioTotal(y);
    const plan1 = plan1ByYear.get(y.year) ?? plan2;
    floor.push(Math.min(plan1, plan2));
    plan2Ahead.push(Math.max(0, plan2 - plan1));
    plan1Ahead.push(Math.max(0, plan1 - plan2));
  }

  const data = {
    labels,
    datasets: [
      {
        label: `Common floor (vs ${plan1Label})`,
        data: floor,
        backgroundColor: "#2563eb",
        stack: "portfolio",
      },
      {
        label: `${plan2Label} ahead of ${plan1Label}`,
        data: plan2Ahead,
        backgroundColor: "#059669",
        stack: "portfolio",
      },
      {
        label: `${plan1Label} ahead of ${plan2Label}`,
        data: plan1Ahead,
        backgroundColor: "#9ca3af",
        stack: "portfolio",
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
        displayColors: false,
        filter: (item: TooltipItem<"bar">) => item.datasetIndex === 0,
        callbacks: {
          label: (ctx: TooltipItem<"bar">) => {
            const ds = ctx.chart.data.datasets;
            const i = ctx.dataIndex;
            const f = (ds[0]?.data[i] as number | undefined) ?? 0;
            const ahead = (ds[1]?.data[i] as number | undefined) ?? 0;
            const behind = (ds[2]?.data[i] as number | undefined) ?? 0;
            const plan1Total = f + behind;
            const plan2Total = f + ahead;
            const delta = plan2Total - plan1Total;
            const sign = delta >= 0 ? "+" : "−";
            return [
              `${plan1Label}: ${usd.format(plan1Total)}`,
              `${plan2Label}: ${usd.format(plan2Total)}`,
              `Δ: ${sign}${usd.format(Math.abs(delta))}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { stacked: true, ticks: { color: "#94a3b8" }, grid: { display: false } },
      y: {
        stacked: true,
        ticks: { color: "#94a3b8", callback: (v: number | string) => usd.format(Number(v)) },
        grid: { color: "rgba(148, 163, 184, 0.15)" },
      },
    },
  };

  return (
    <div className="h-72 w-full">
      <Bar data={data} options={options} />
    </div>
  );
}
