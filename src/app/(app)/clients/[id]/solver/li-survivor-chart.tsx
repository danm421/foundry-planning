"use client";

// Life Insurance solver — survivor projection chart (Task 11).
//
// A line chart of the surviving spouse's liquid portfolio balance by year,
// reading `LiSolveCase.projection`. A segmented toggle switches between the
// client-death and spouse-death survivor projections; for a single plan only
// the client-death projection is shown and the toggle is hidden.
//
// Styling mirrors `solver-chart-panel.tsx` / `portfolio-bars-chart.tsx`:
// the same card chrome, dark-theme axis colors, and currency tick/tooltip
// formatting, so the chart reads as native to the solver page.
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-chart";
import type { LiSolveResult } from "./solver-tab-life-insurance";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
);

const fmtNum = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type DeathOf = "client" | "spouse";

interface Props {
  result: LiSolveResult;
  clientName: string;
  spouseName: string;
}

export function LiSurvivorChart({ result, clientName, spouseName }: Props) {
  // Default to the client-death survivor projection; the toggle only matters
  // when the plan is married (a spouse projection exists to switch to).
  const [deathOf, setDeathOf] = useState<DeathOf>("client");

  const showToggle = result.isMarried && result.spouse != null;
  const activeCase =
    deathOf === "spouse" && result.spouse ? result.spouse : result.client;
  const survivorName = deathOf === "spouse" ? clientName : spouseName;

  const { labels, data } = useMemo(() => {
    const years = activeCase.projection;
    return {
      labels: years.map((y) => String(y.year)),
      data: years.map((y) => liquidPortfolioTotal(y)),
    };
  }, [activeCase]);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Survivor Portfolio Assets",
        data,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.12)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
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
            `${ctx.dataset.label}: ${fmtNum.format(Number(ctx.raw))}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9ca3af" },
        grid: { color: "#374151" },
      },
      y: {
        ticks: {
          color: "#9ca3af",
          callback: (value: unknown) => fmtNum.format(Number(value)),
        },
        grid: { color: "#374151" },
      },
    },
  };

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-ink">
          Survivor Portfolio Projection
        </div>
        {showToggle ? (
          <div
            role="tablist"
            aria-label="Survivor projection"
            className="inline-flex rounded-md border border-hair-2 bg-card-2 p-0.5"
          >
            <ToggleButton
              label={`${clientName} dies`}
              selected={deathOf === "client"}
              onClick={() => setDeathOf("client")}
            />
            <ToggleButton
              label={`${spouseName} dies`}
              selected={deathOf === "spouse"}
              onClick={() => setDeathOf("spouse")}
            />
          </div>
        ) : null}
      </div>

      <p className="mb-2 text-[11px] text-ink-3">
        {showToggle
          ? `Portfolio of ${survivorName} as the surviving spouse.`
          : "Surviving household portfolio after death."}
      </p>

      <div style={{ height: 300 }}>
        <Line data={chartData} options={chartOptions} />
      </div>
    </div>
  );
}

function ToggleButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
        selected ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
