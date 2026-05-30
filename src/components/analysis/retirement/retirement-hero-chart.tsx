"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine/types";
import { retirementInflows } from "@/lib/analysis/retirement-inflows";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

// Inflow palette mirrors the Cash Flow report's stacked chart so the two read
// the same. Shortfall is retirement-specific (no Cash Flow equivalent) and uses
// a distinct pink to separate it from the red Withdrawals band.
const COLOR_SS = "#2563eb"; // Social Security (navy)
const COLOR_SALARIES = "#16a34a"; // Salaries (green)
const COLOR_OTHER = "#99f6e4"; // Other Inflows (teal)
const COLOR_RMDS = "#f97316"; // RMDs (orange)
const COLOR_WITHDRAWALS = "#ef4444"; // Withdrawals (red)
const COLOR_EXPENSES_LINE = "#ffffff"; // Total Expenses line

interface RetirementHeroChartProps {
  years: ProjectionYear[];
  height?: number;
}

export function RetirementHeroChart({ years, height = 320 }: RetirementHeroChartProps) {
  const data = useMemo(() => {
    if (years.length === 0) return null;

    const labels = years.map((y) => String(y.year));
    const inflows = years.map(retirementInflows);

    return {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Social Security",
          data: inflows.map((i) => i.socialSecurity),
          backgroundColor: COLOR_SS,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "Salaries",
          data: inflows.map((i) => i.salaries),
          backgroundColor: COLOR_SALARIES,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "Other Inflows",
          data: inflows.map((i) => i.otherInflows),
          backgroundColor: COLOR_OTHER,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "RMDs",
          data: inflows.map((i) => i.rmds),
          backgroundColor: COLOR_RMDS,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "Withdrawals from Assets",
          data: inflows.map((i) => i.withdrawals),
          backgroundColor: COLOR_WITHDRAWALS,
          stack: "income",
        },
        {
          type: "line" as const,
          label: "Total Expenses",
          data: years.map((y) => y.totalExpenses),
          borderColor: COLOR_EXPENSES_LINE,
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
        },
      ],
    };
  }, [years]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        // Respect prefers-reduced-motion: Chart.js has no built-in hook,
        // so we mirror the pattern used in globals.css and disable animation
        // when the user has requested reduced motion.
        duration:
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : 1000,
      },
      plugins: {
        legend: {
          display: true,
          labels: { color: "#d1d5db", boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: "#9ca3af",
            // Let Chart.js autoskip so dense tick labels don't overlap;
            // mirrors the behaviour of the existing StackedBarChart.
            maxRotation: 0,
            autoSkip: true,
          },
          grid: { color: "#374151" },
        },
        y: {
          stacked: true,
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => formatCurrency(Number(value)),
          },
          grid: { color: "#374151" },
        },
      },
    }),
    [],
  );

  if (!data) return null;

  return (
    <div
      style={{ height }}
      aria-label="Projected annual income sources versus expenses by year"
      role="img"
    >
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
