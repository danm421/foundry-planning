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
import { chartChrome, useThemeName } from "@/lib/chart-colors";

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
// the same. Withdrawals uses the semantic crit token (loss/danger).
const COLOR_SS          = "var(--color-data-indigo)";
const COLOR_SALARIES    = "var(--color-data-emerald)";
const COLOR_OTHER       = "var(--color-data-slate)";
const COLOR_RMDS        = "var(--color-data-terra)";
const COLOR_WITHDRAWALS = "var(--color-crit)";
const COLOR_EXPENSES_LINE = "var(--color-ink)";

interface RetirementHeroChartProps {
  years: ProjectionYear[];
  height?: number;
}

export function RetirementHeroChart({ years, height = 320 }: RetirementHeroChartProps) {
  const theme = useThemeName();

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

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
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
          labels: { color: chrome.legend, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
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
            color: chrome.tick,
            // Let Chart.js autoskip so dense tick labels don't overlap;
            // mirrors the behaviour of the existing StackedBarChart.
            maxRotation: 0,
            autoSkip: true,
          },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: true,
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => formatCurrency(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);

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
