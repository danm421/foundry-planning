"use client";

// Life-insurance need-over-time view — rendered as the "Life Insurance Need"
// tab inside the solver's top chart panel. Presentational: it receives the
// solve state from `useNeedOverTime` (owned by SolverChartPanel) and renders
// the Run/Cancel controls, progress bar, and a single-dataset Chart.js line
// chart whose series is chosen by a married-only client/spouse toggle.
import { useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";
import type { OverTimeProgress } from "./use-need-over-time";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

interface Props {
  rows: NeedOverTimeRow[] | null;
  isRunning: boolean;
  progress: OverTimeProgress | null;
  errorMessage: string | null;
  onRun: () => void;
  onCancel: () => void;
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}

export function LiNeedOverTimeView({
  rows,
  isRunning,
  progress,
  errorMessage,
  onRun,
  onCancel,
  isMarried,
  clientName,
  spouseName,
}: Props) {
  // Which decedent's need the chart plots. The toggle only renders when
  // married; for a single plan it stays "client".
  const [deathOf, setDeathOf] = useState<"client" | "spouse">("client");
  const activeDeathOf = isMarried ? deathOf : "client";

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="h-9 rounded-md bg-accent px-3.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Run need over time
        </button>
        {isRunning ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-md border border-hair-2 px-3 text-[12px] text-ink-2 hover:bg-card-2"
          >
            Cancel
          </button>
        ) : null}
        {rows && !isRunning && isMarried ? (
          <div
            role="tablist"
            aria-label="Death scenario"
            className="ml-auto inline-flex rounded-md border border-hair-2 bg-card-2 p-0.5"
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

      {isRunning ? <OverTimeProgressBar progress={progress} /> : null}

      {errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {rows && !isRunning ? (
        <div className="mt-3" style={{ height: 300 }}>
          <Line
            data={buildChartData(rows, activeDeathOf, clientName, spouseName)}
            options={CHART_OPTIONS}
          />
        </div>
      ) : !isRunning && !errorMessage ? (
        <p className="mt-3 text-[12px] text-ink-3">
          Run the solve to see life-insurance need by year of death.
        </p>
      ) : null}
    </div>
  );
}

/** Build the single-dataset chart payload for the selected decedent. */
function buildChartData(
  rows: NeedOverTimeRow[],
  deathOf: "client" | "spouse",
  clientName: string,
  spouseName: string,
) {
  const labels = rows.map((r) => String(r.year));
  return {
    labels,
    datasets: [
      deathOf === "spouse"
        ? {
            label: `${spouseName} dies`,
            data: rows.map((r) => roundUpTo50k(r.spouseNeed ?? 0)),
            borderColor: "#d97706",
            backgroundColor: "#d97706",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
          }
        : {
            label: `${clientName} dies`,
            data: rows.map((r) => roundUpTo50k(r.clientNeed)),
            borderColor: "#2563eb",
            backgroundColor: "#2563eb",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
          },
    ],
  };
}

const CHART_OPTIONS = {
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
          `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}`,
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
        callback: (value: unknown) => formatCurrency(Number(value)),
      },
      grid: { color: "#374151" },
    },
  },
};

/** Progress bar driven by the route's per-year `done/total` count. */
function OverTimeProgressBar({
  progress,
}: {
  progress: OverTimeProgress | null;
}) {
  let pct = 0;
  let label = "Starting need-over-time solve…";
  if (progress && progress.total > 0) {
    pct = Math.min(100, (progress.done / progress.total) * 100);
    label = `Solving year ${progress.done} of ${progress.total}…`;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <span className="text-[11px] tabular text-ink-3">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-hair-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Segmented toggle button — mirrors the solver tab's tab styling. */
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
