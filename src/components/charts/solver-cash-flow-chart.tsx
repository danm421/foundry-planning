"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface CashFlowDataset {
  type: "bar" | "line";
  label: string;
  data: number[];
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  stack?: string;
  fill?: boolean;
  pointRadius?: number;
  tension?: number;
  order?: number;
}

/**
 * Pure dataset builder for the solver Cash Flow chart. Mirrors the main
 * cash-flow report (`cashflow-report.tsx`): five stacked income bars plus a
 * Total Expenses line. If the report's income segments change, update this
 * in tandem.
 */
export function buildSolverCashFlowChartData(years: ProjectionYear[]): {
  labels: string[];
  datasets: CashFlowDataset[];
} {
  const otherIncome = (y: ProjectionYear) =>
    y.income.business +
    y.income.deferred +
    y.income.capitalGains +
    y.income.trust +
    y.income.other;
  const rmd = (y: ProjectionYear) =>
    Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);

  return {
    labels: years.map((y) => String(y.year)),
    datasets: [
      {
        type: "bar",
        label: "Social Security",
        data: years.map((y) => y.income.socialSecurity),
        backgroundColor: "#2563eb",
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Salaries",
        data: years.map((y) => y.income.salaries),
        backgroundColor: "#16a34a",
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Other Inflows",
        data: years.map(otherIncome),
        backgroundColor: "#99f6e4",
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "RMDs",
        data: years.map(rmd),
        backgroundColor: "#f97316",
        stack: "inflows",
        order: 1,
      },
      {
        type: "bar",
        label: "Withdrawals",
        data: years.map((y) => y.withdrawals.total),
        backgroundColor: "#ef4444",
        stack: "inflows",
        order: 1,
      },
      {
        type: "line",
        label: "Total Expenses",
        data: years.map((y) => y.totalExpenses),
        borderColor: "#ffffff",
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        order: 0,
      },
    ],
  };
}

interface Props {
  years: ProjectionYear[];
}

export function SolverCashFlowChart({ years }: Props) {
  const data = useMemo(() => buildSolverCashFlowChartData(years), [years]);

  return (
    <Chart
      type="bar"
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
          y: {
            stacked: true,
            ticks: {
              color: "#9ca3af",
              callback: (v) => fmtCompact.format(Number(v)),
            },
            grid: { color: "#1f2937" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e5e7eb" } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${fmtFull.format(Number(ctx.parsed.y))}`,
            },
          },
        },
      }}
    />
  );
}
