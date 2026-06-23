// src/components/portal/budget-history-chart.tsx
"use client";
import type { ReactElement } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette, statusColors } from "@/lib/chart-colors";
import { fmtUsd } from "@/lib/portal/format";
import type { Heat, HistoryBar } from "@/lib/portal/category-detail";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const MONTH_LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function tokenToHex(token: string, pal: Record<string, string>): string {
  const key = token.match(/var\(--data-([a-z]+)\)/)?.[1];
  return (key && pal[key]) || pal.grey;
}

function monthTitle(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * 24-month spend bars heat-colored vs the category budget, with a horizontal
 * budget reference line drawn over the bars (matches the Monarch-style detail
 * panel). No y-axis chrome — the budget line is the only reference the eye needs.
 */
export function BudgetHistoryChart({
  history,
  budget,
  categoryColor,
}: {
  history: HistoryBar[];
  budget: number | null;
  categoryColor: string;
}): ReactElement {
  const theme = useThemeName();
  const pal = dataPalette(theme) as unknown as Record<string, string>;
  const chrome = chartChrome(theme);
  const status = statusColors(theme);
  const catHex = tokenToHex(categoryColor, pal);

  function heatHex(h: Heat): string {
    if (h === "good") return status.good;
    if (h === "warn") return status.warn;
    if (h === "crit") return status.crit;
    return catHex;
  }

  const maxAmount = history.reduce((m, b) => Math.max(m, b.amount), 0);
  const yMax = Math.max(maxAmount, budget ?? 0) * 1.12 || 10;

  const data = {
    labels: history.map((b) => b.month),
    datasets: [
      {
        data: history.map((b) => Math.max(0, b.amount)),
        backgroundColor: history.map((b) => heatHex(b.heat)),
        borderWidth: 0,
        borderRadius: 3,
        barPercentage: 0.72,
        categoryPercentage: 0.86,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8 } },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: chrome.tick,
          font: { size: 9 },
          maxRotation: 0,
          autoSkip: false,
          callback(_v, i) {
            const month = history[i]?.month;
            if (!month) return "";
            return MONTH_LETTER[Number(month.slice(5, 7)) - 1];
          },
        },
      },
      y: { display: false, beginAtZero: true, max: yMax },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: {
          title: (items) => monthTitle(String(items[0]?.label ?? "")),
          label: (c) => fmtUsd(history[c.dataIndex]?.amount ?? 0),
        },
      },
    },
  };

  const budgetLine: Plugin<"bar"> = {
    id: "budgetLine",
    afterDatasetsDraw(chart) {
      if (budget == null || budget <= 0) return;
      const y = chart.scales.y.getPixelForValue(budget);
      const { left, right } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = chrome.title;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      // Right-edge pill with the budget figure.
      const text = fmtUsd(budget);
      ctx.font = "600 10px ui-monospace, monospace";
      const padX = 5;
      const w = ctx.measureText(text).width + padX * 2;
      const h = 15;
      const px = right - w;
      const py = y - h / 2;
      ctx.fillStyle = chrome.tooltipBg;
      ctx.strokeStyle = chrome.grid;
      ctx.lineWidth = 1;
      const r = 4;
      ctx.beginPath();
      ctx.roundRect(px, py, w, h, r);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = chrome.title;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(text, px + padX, y + 0.5);
      ctx.restore();
    },
  };

  return (
    <div className="h-32">
      <Bar data={data} options={options} plugins={[budgetLine]} />
    </div>
  );
}
