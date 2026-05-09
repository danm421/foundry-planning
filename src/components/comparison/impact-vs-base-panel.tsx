"use client";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { TooltipItem } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export interface ImpactVsBaseValues {
  totalToHeirs: number;
  taxesAndExpenses: number;
  totalToCharities: number;
}

interface Props {
  year: number;
  plan1Label: string;
  plan2Label: string;
  plan1: ImpactVsBaseValues;
  plan2: ImpactVsBaseValues;
}

function formatDelta(d: number): string {
  if (d === 0) return "+$0";
  const sign = d > 0 ? "+" : "-";
  return `${sign}${usd.format(Math.abs(d))}`;
}

function deltaClass(d: number, kind: "good-up" | "good-down"): string {
  if (d === 0) return "text-emerald-400";
  const positive = kind === "good-up" ? d > 0 : d < 0;
  return positive ? "text-emerald-400" : "text-rose-400";
}

export function ImpactVsBasePanel({
  year,
  plan1Label,
  plan2Label,
  plan1,
  plan2,
}: Props) {
  const dHeirs = plan2.totalToHeirs - plan1.totalToHeirs;
  const dTaxes = plan2.taxesAndExpenses - plan1.taxesAndExpenses;
  const dCharities = plan2.totalToCharities - plan1.totalToCharities;

  const data = {
    labels: ["Total to Heirs", "Taxes & Expenses", "Total to Charities"],
    datasets: [
      {
        label: plan1Label,
        data: [plan1.totalToHeirs, plan1.taxesAndExpenses, plan1.totalToCharities],
        backgroundColor: "#60a5fa",
      },
      {
        label: plan2Label,
        data: [plan2.totalToHeirs, plan2.taxesAndExpenses, plan2.totalToCharities],
        backgroundColor: "#f97316",
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#cbd5e1" } },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) =>
            `${ctx.dataset.label}: ${usd.format(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#cbd5e1" },
        grid: { display: false },
      },
      y: {
        ticks: {
          color: "#94a3b8",
          callback: (v: number | string) => usdCompact.format(Number(v)),
        },
        grid: { color: "rgba(148, 163, 184, 0.15)" },
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-100">
        Impact vs {plan1Label} ({year})
      </h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h4 className="mb-4 text-sm font-semibold text-slate-100">Summary Deltas</h4>
          <dl className="space-y-3">
            <div className="flex items-baseline justify-between">
              <dt className="text-sm text-slate-300">Change in Total to Heirs</dt>
              <dd className={`text-sm font-semibold ${deltaClass(dHeirs, "good-up")}`}>
                {formatDelta(dHeirs)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-sm text-slate-300">Change in Taxes &amp; Expenses</dt>
              <dd className={`text-sm font-semibold ${deltaClass(dTaxes, "good-down")}`}>
                {formatDelta(dTaxes)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-sm text-slate-300">Change in Total to Charities</dt>
              <dd className={`text-sm font-semibold ${deltaClass(dCharities, "good-up")}`}>
                {formatDelta(dCharities)}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h4 className="mb-2 text-center text-sm font-semibold text-slate-100">
            {plan1Label} vs {plan2Label}
          </h4>
          <div className="h-72 w-full">
            <Bar data={data} options={options} />
          </div>
        </div>
      </div>
    </div>
  );
}
