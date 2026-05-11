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
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";

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

function fmtDelta(d: number): string {
  if (d === 0) return "+$0";
  return `${d > 0 ? "+" : "−"}${usd.format(Math.abs(d))}`;
}
function deltaClass(d: number, kind: "good-up" | "good-down"): string {
  if (d === 0) return "text-emerald-400";
  const positive = kind === "good-up" ? d > 0 : d < 0;
  return positive ? "text-emerald-400" : "text-rose-400";
}

interface ImpactValues {
  totalToHeirs: number;
  taxesAndExpenses: number;
  totalToCharities: number;
}

function valuesFromPlan(p: ComparisonPlan): ImpactValues {
  return {
    totalToHeirs: p.finalEstate?.totalToHeirs ?? 0,
    taxesAndExpenses: p.finalEstate?.taxesAndExpenses ?? 0,
    totalToCharities: p.finalEstate?.charity ?? 0,
  };
}

interface Props {
  year: number;
  plans: ComparisonPlan[];
}

export function ImpactVsBasePanel({ year, plans }: Props) {
  const values = plans.map(valuesFromPlan);
  const baseline = values[0];

  const data = {
    labels: ["Total to Heirs", "Taxes & Expenses", "Total to Charities"],
    datasets: plans.map((p, i) => ({
      label: p.label,
      data: [
        values[i].totalToHeirs,
        values[i].taxesAndExpenses,
        values[i].totalToCharities,
      ],
      backgroundColor: seriesColor(i) ?? "#cbd5e1",
    })),
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
      x: { ticks: { color: "#cbd5e1" }, grid: { display: false } },
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

  // Deltas only render for non-baseline plans.
  const others = plans.slice(1);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-100">
        Impact vs {plans[0].label} ({year})
      </h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h4 className="mb-4 text-sm font-semibold text-slate-100">Summary Deltas</h4>
          <div className="space-y-4">
            {others.map((p, idx) => {
              const i = idx + 1; // palette index for the non-baseline plan
              const v = values[i];
              const dHeirs = v.totalToHeirs - baseline.totalToHeirs;
              const dTaxes = v.taxesAndExpenses - baseline.taxesAndExpenses;
              const dChar = v.totalToCharities - baseline.totalToCharities;
              return (
                <div key={i} className="rounded border border-slate-800 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: seriesColor(i) }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-slate-100">{p.label}</span>
                  </div>
                  <dl className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <dt className="text-sm text-slate-300">Change in Total to Heirs</dt>
                      <dd className={`text-sm font-semibold ${deltaClass(dHeirs, "good-up")}`}>
                        {fmtDelta(dHeirs)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <dt className="text-sm text-slate-300">Change in Taxes &amp; Expenses</dt>
                      <dd className={`text-sm font-semibold ${deltaClass(dTaxes, "good-down")}`}>
                        {fmtDelta(dTaxes)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <dt className="text-sm text-slate-300">Change in Total to Charities</dt>
                      <dd className={`text-sm font-semibold ${deltaClass(dChar, "good-up")}`}>
                        {fmtDelta(dChar)}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h4 className="mb-2 text-center text-sm font-semibold text-slate-100">
            Estate Disposition
          </h4>
          <div className="h-72 w-full">
            <Bar data={data} options={options} />
          </div>
        </div>
      </div>
    </div>
  );
}
