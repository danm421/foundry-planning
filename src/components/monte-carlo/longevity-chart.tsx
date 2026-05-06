"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { formatPercent } from "./lib/format";
import { PromoteButton } from "./promote-button";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface LongevityChartProps {
  /** Trial-major matrix: rows are trials, cols are plan years. */
  byYearLiquidAssetsPerTrial: number[][];
  /** Fraction in [0, 1] is treated as "success" if balance > this threshold. */
  requiredMinimumAssetLevel: number;
  /** Year corresponding to column 0 of the matrix. */
  planStartYear: number;
  /** Birth year of primary client; if known, the x-axis labels render as ages. */
  clientBirthYear?: number;
  variant?: "main" | "compact";
  onPromote?: () => void;
}

interface LongevityYear {
  age: number | null;
  year: number;
  successRate: number;
}

export function LongevityChart({
  byYearLiquidAssetsPerTrial,
  requiredMinimumAssetLevel,
  planStartYear,
  clientBirthYear,
  variant = "compact",
  onPromote,
}: LongevityChartProps) {
  const isMain = variant === "main";
  const data = useMemo<LongevityYear[]>(() => {
    const trialCount = byYearLiquidAssetsPerTrial.length;
    if (trialCount === 0) return [];
    const yearCount = byYearLiquidAssetsPerTrial[0].length;
    const rows: LongevityYear[] = [];
    for (let i = 0; i < yearCount; i++) {
      let above = 0;
      for (let t = 0; t < trialCount; t++) {
        if (byYearLiquidAssetsPerTrial[t][i] > requiredMinimumAssetLevel) above++;
      }
      const year = planStartYear + i;
      rows.push({
        year,
        age: clientBirthYear != null ? year - clientBirthYear : null,
        successRate: above / trialCount,
      });
    }
    return rows;
  }, [byYearLiquidAssetsPerTrial, requiredMinimumAssetLevel, planStartYear, clientBirthYear]);

  if (data.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Longevity</h3>
        <p className="text-sm text-slate-400">No trial data available.</p>
      </section>
    );
  }

  const chartData = {
    labels: data.map((d) => (d.age != null ? d.age.toString() : d.year.toString())),
    datasets: [
      {
        label: "Probability of Success",
        data: data.map((d) => d.successRate * 100),
        backgroundColor: data.map((d) => {
          if (d.successRate >= 0.9) return "rgba(52, 211, 153, 0.8)";
          if (d.successRate >= 0.75) return "rgba(250, 204, 21, 0.8)";
          if (d.successRate >= 0.5) return "rgba(251, 146, 60, 0.85)";
          return "rgba(251, 113, 133, 0.85)";
        }),
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 0.92,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        callbacks: {
          title: (items: TooltipItem<"bar">[]) => {
            const row = data[items[0]?.dataIndex ?? 0];
            if (!row) return "";
            return row.age != null ? `Age ${row.age} (${row.year})` : `${row.year}`;
          },
          label: (ctx: TooltipItem<"bar">) => {
            const row = data[ctx.dataIndex];
            if (!row) return "";
            return `${formatPercent(row.successRate)} of trials have assets remaining`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "rgb(148, 163, 184)",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        max: 100,
        grid: { color: "rgba(148, 163, 184, 0.1)" },
        ticks: {
          color: "rgb(148, 163, 184)",
          font: { size: 10 },
          callback: (value) => `${value}%`,
          stepSize: 25,
        },
      },
    },
  };

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            className={
              isMain
                ? "text-base font-semibold text-slate-100"
                : "text-sm font-semibold text-slate-100"
            }
          >
            Longevity
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 mb-3">
            Probability of having assets remaining at each {clientBirthYear != null ? "age" : "year"}
          </p>
        </div>
        {!isMain && onPromote && <PromoteButton onPromote={onPromote} />}
      </div>
      <div className={isMain ? "h-[400px]" : "h-[220px]"}>
        <Bar data={chartData} options={options} />
      </div>
    </section>
  );
}
