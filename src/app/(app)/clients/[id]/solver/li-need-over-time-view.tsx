"use client";

// Life-insurance need-over-time view — rendered as the "Life Insurance Need"
// tab inside the solver's top chart panel. Presentational: it receives the
// solve state from `useNeedOverTime` (owned by SolverChartPanel, which
// auto-runs the solve when this report is active) and renders the progress
// bar plus a single-dataset Chart.js bar chart whose series is chosen by a
// married-only client/spouse toggle.
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";
import type { OverTimeProgress, YearRange } from "./use-need-over-time";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface Props {
  rows: NeedOverTimeRow[] | null;
  yearRange: YearRange | null;
  isRunning: boolean;
  progress: OverTimeProgress | null;
  errorMessage: string | null;
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}

export function LiNeedOverTimeView({
  rows,
  yearRange,
  isRunning,
  progress,
  errorMessage,
  isMarried,
  clientName,
  spouseName,
}: Props) {
  // Which decedent's need the chart plots. The toggle only renders when
  // married; for a single plan it stays "client".
  const [deathOf, setDeathOf] = useState<"client" | "spouse">("client");
  const activeDeathOf = isMarried ? deathOf : "client";

  return (
    <div className="flex h-full flex-col">
      {yearRange && isMarried ? (
        <div className="flex items-center">
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
        </div>
      ) : null}

      {isRunning ? <OverTimeProgressBar progress={progress} /> : null}

      {errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Fills the remaining height of the resizable panel below the controls.
          Rendered whenever the route's `meta` event has landed — before that,
          rows haven't started streaming in yet. Not gated on `!isRunning`:
          the whole point of the stable axis is that solved bars rise into
          place while the solve is still running. */}
      <div className="mt-3 min-h-0 flex-1">
        {yearRange ? (
          <ChartPanel
            rows={rows ?? []}
            yearRange={yearRange}
            activeDeathOf={activeDeathOf}
            clientName={clientName}
            spouseName={spouseName}
          />
        ) : !errorMessage ? (
          <p className="text-[12px] text-ink-3">
            Preparing the life-insurance need-by-year solve…
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Inner chart component so we can call hooks (useThemeName). */
function ChartPanel({
  rows,
  yearRange,
  activeDeathOf,
  clientName,
  spouseName,
}: {
  rows: NeedOverTimeRow[];
  yearRange: YearRange;
  activeDeathOf: "client" | "spouse";
  clientName: string;
  spouseName: string;
}) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const pal = dataPalette(theme);

  // Stable full-plan year axis, independent of how many rows have streamed
  // in so far — indexed by year so bars rise into place left-to-right as the
  // solve progresses instead of the axis growing underneath the advisor.
  // Only depends on `yearRange`, which is fixed for the life of a run, so it
  // doesn't rebuild on every streamed row — unlike `data` below, which does.
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = yearRange.planStartYear; y <= yearRange.planEndYear; y++) {
      out.push(y);
    }
    return out;
  }, [yearRange.planStartYear, yearRange.planEndYear]);
  const labels = useMemo(() => years.map((y) => String(y)), [years]);

  const seriesLabel = activeDeathOf === "spouse" ? `${spouseName} dies` : `${clientName} dies`;
  const seriesColor = activeDeathOf === "spouse" ? pal.grey : pal.blue;
  const data = useMemo(() => {
    const byYear = new Map(rows.map((r) => [r.year, r]));
    const valueFor = (y: number): number | null => {
      const r = byYear.get(y);
      if (!r) return null;
      return activeDeathOf === "spouse"
        ? roundUpTo50k(r.spouseNeed ?? 0)
        : roundUpTo50k(r.clientNeed);
    };
    return {
      labels,
      datasets: [
        {
          label: seriesLabel,
          data: years.map(valueFor),
          backgroundColor: seriesColor,
          borderColor: seriesColor,
          borderWidth: 1,
        },
      ],
    };
  }, [rows, years, labels, activeDeathOf, seriesLabel, seriesColor]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
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
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => formatCurrency(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    }),
    [chrome],
  );
  return (
    <div className="h-full">
      <Bar data={data} options={options} />
    </div>
  );
}

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
