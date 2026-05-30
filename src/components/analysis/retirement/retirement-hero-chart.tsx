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

// Resolved from globals.css @theme tokens — Chart.js cannot read CSS variables directly.
// --color-good: #34d399  (Social Security)
// --color-accent: #f59e0b (Withdrawals from Assets)
// --color-crit: #f87171  (Shortfall)
// --color-ink-2: #c7cbd4  (Total Expenses line)
const COLOR_SS = "#34d399";
const COLOR_WITHDRAWALS = "#f59e0b";
const COLOR_SHORTFALL = "#f87171";
const COLOR_EXPENSES_LINE = "#c7cbd4";

interface RetirementHeroChartProps {
  years: ProjectionYear[];
  height?: number;
}

export function RetirementHeroChart({ years, height = 320 }: RetirementHeroChartProps) {
  const data = useMemo(() => {
    if (years.length === 0) return null;

    const labels = years.map((y) => String(y.year));

    return {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Social Security",
          data: years.map((y) => y.income.socialSecurity),
          backgroundColor: COLOR_SS,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "Withdrawals from Assets",
          data: years.map((y) => y.withdrawals.total),
          backgroundColor: COLOR_WITHDRAWALS,
          stack: "income",
        },
        {
          type: "bar" as const,
          label: "Shortfall",
          data: years.map((y) =>
            Math.max(
              0,
              y.totalExpenses - y.income.total - y.withdrawals.total,
            ),
          ),
          backgroundColor: COLOR_SHORTFALL,
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
