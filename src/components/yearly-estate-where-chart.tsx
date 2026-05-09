"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  rows: YearlyEstateRow[];
}

export function YearlyEstateWhereChart({ rows }: Props) {
  const data = useMemo(() => {
    if (rows.length === 0) return null;
    return {
      labels: rows.map((r) => String(r.year)),
      datasets: [
        {
          label: "Net to Heirs",
          data: rows.map((r) => r.netToHeirs),
          backgroundColor: "#16a34a",
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "Taxes & Expenses",
          data: rows.map((r) => r.taxesAndExpenses),
          backgroundColor: "#e11d48",
          stack: "main",
          borderWidth: 0,
        },
        {
          label: "Charitable Bequests",
          data: rows.map((r) => r.charitableBequests),
          backgroundColor: "#f59e0b",
          stack: "main",
          borderWidth: 0,
        },
      ],
    };
  }, [rows]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
          labels: { color: "#d1d5db", boxWidth: 12, padding: 12 },
        },
        tooltip: {
          mode: "index" as const,
          intersect: false,
          backgroundColor: "#1f2937",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#9ca3af" },
          grid: { color: "#374151" },
        },
        y: {
          stacked: true,
          ticks: {
            color: "#9ca3af",
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { color: "#374151" },
        },
      },
    }),
    [],
  );

  if (!data) return null;

  return (
    <div style={{ height: 280 }}>
      <Bar data={data} options={options} />
    </div>
  );
}
