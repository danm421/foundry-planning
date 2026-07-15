"use client";

// Life-insurance need-over-time view — rendered as the "Life Insurance Need"
// tab inside the solver's top chart panel. Presentational: it receives the
// solve state from `useNeedOverTime` (owned by SolverChartPanel, which
// auto-runs the solve when this report is active) and renders the progress
// bar plus a Chart.js bar chart.
//
// The chart stacks each year's client-death and spouse-death need into one
// bar (client on the bottom, spouse on top) so both what-if scenarios read at
// a glance. Four phases:
//   • preparing — before the plan year range lands: the animated shield loader.
//   • streaming — bars rise into the full stable plan-year axis as the solve
//     fills in, so the axis never grows underneath the advisor.
//   • done      — the axis collapses to just the need window (the years that
//     actually carry a need), with a staggered grow-in reveal.
//   • empty     — no year ever has a need: a clean "no need" display.
import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartDataset,
  type ScriptableContext,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import { clipToNeedWindow } from "@/lib/life-insurance/need-window";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";
import type { OverTimeProgress, YearRange } from "./use-need-over-time";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { ShieldLoader, NoNeedState } from "./li-need-skeleton";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** Shared stack id — both segments in one bar. */
const STACK_ID = "need";

// Stable empty fallbacks so at-rest re-renders don't hand the chart fresh refs.
const EMPTY_YEARS: number[] = [];
const EMPTY_ROWS: NeedOverTimeRow[] = [];

interface Props {
  // NOTE: this component assumes it's only mounted while the Life Insurance
  // Need report is active — the solve auto-runs on mount (SolverChartPanel) —
  // so there's no separate idle phase: `!yearRange` always means "preparing",
  // never "disabled".
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
  return (
    <div className="flex h-full flex-col">
      {isRunning ? <OverTimeProgressBar progress={progress} /> : null}

      {errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Fills the remaining height of the resizable panel below the controls. */}
      <div className="mt-3 min-h-0 flex-1">
        <ChartArea
          rows={rows}
          yearRange={yearRange}
          isRunning={isRunning}
          hasError={errorMessage != null}
          isMarried={isMarried}
          clientName={clientName}
          spouseName={spouseName}
        />
      </div>
    </div>
  );
}

/** Picks the phase (skeleton / streaming chart / clipped chart / empty). */
function ChartArea({
  rows,
  yearRange,
  isRunning,
  hasError,
  isMarried,
  clientName,
  spouseName,
}: {
  rows: NeedOverTimeRow[] | null;
  yearRange: YearRange | null;
  isRunning: boolean;
  hasError: boolean;
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}) {
  // Clip to the need window once the solve is done; mid-run keep every plan
  // year so the axis stays stable while bars fill in. Memoized (keyed on the
  // stable `rows`/`yearRange` refs) so incidental re-renders — e.g. a
  // chart-panel resize drag — don't hand NeedBarChart fresh array refs and
  // force a needless chart.update().
  const clipped = useMemo(
    () => (isRunning ? null : clipToNeedWindow(rows ?? [])),
    [isRunning, rows],
  );
  const years = useMemo(
    () =>
      clipped
        ? clipped.map((r) => r.year)
        : yearRange
          ? rangeYears(yearRange)
          : EMPTY_YEARS,
    [clipped, yearRange],
  );

  // Before the plan year range lands there's nothing to plot — show the
  // animated shield loader (unless the run has already errored out).
  if (!yearRange) {
    return hasError ? null : <ShieldLoader />;
  }

  if (clipped && clipped.length === 0) {
    return (
      <NoNeedState
        isMarried={isMarried}
        clientName={clientName}
        spouseName={spouseName}
      />
    );
  }

  return (
    <NeedBarChart
      years={years}
      rows={clipped ?? rows ?? EMPTY_ROWS}
      isMarried={isMarried}
      clientName={clientName}
      spouseName={spouseName}
      streaming={isRunning}
    />
  );
}

/** Every plan year, inclusive — the stable streaming axis. */
function rangeYears(yr: YearRange): number[] {
  const out: number[] = [];
  for (let y = yr.planStartYear; y <= yr.planEndYear; y++) out.push(y);
  return out;
}

/** The stacked bar chart. Inner component so it can call theme/motion hooks. */
function NeedBarChart({
  years,
  rows,
  isMarried,
  clientName,
  spouseName,
  streaming,
}: {
  years: number[];
  rows: NeedOverTimeRow[];
  isMarried: boolean;
  clientName: string;
  spouseName: string;
  streaming: boolean;
}) {
  const theme = useThemeName();
  const reducedMotion = usePrefersReducedMotion();

  // `pal` is derived inside the memo (keyed on the primitive `theme`) so the
  // data only rebuilds on real input changes — matching the streaming-chart
  // memoization elsewhere in the solver.
  const data = useMemo(() => {
    const pal = dataPalette(theme);
    const labels = years.map(String);
    const byYear = new Map(rows.map((r) => [r.year, r]));

    // Client on the bottom of the stack, spouse on top (married only). Each is
    // an independent "if X dies that year" scenario, so they're two segments,
    // never a meaningful sum.
    const series: {
      label: string;
      color: string;
      need: (r: NeedOverTimeRow) => number;
    }[] = [
      { label: `${clientName} dies`, color: pal.blue, need: (r) => r.clientNeed },
    ];
    if (isMarried) {
      series.push({
        label: `${spouseName} dies`,
        color: pal.grey,
        need: (r) => r.spouseNeed ?? 0,
      });
    }

    const datasets: ChartDataset<"bar">[] = series.map((s) => ({
      label: s.label,
      // A missing row is a not-yet-solved year → `null` gap (Chart.js skips
      // it); a solved row with $0 need is a real `0` bar.
      data: years.map((y) => {
        const r = byYear.get(y);
        return r ? roundUpTo50k(s.need(r)) : null;
      }),
      backgroundColor: s.color,
      borderColor: s.color,
      borderWidth: 0,
      borderRadius: 3,
      maxBarThickness: 48,
      stack: STACK_ID,
    }));

    return { labels, datasets };
  }, [years, rows, isMarried, clientName, spouseName, theme]);

  const options = useMemo<ChartOptions<"bar">>(() => {
    const chrome = chartChrome(theme);

    // Streaming re-renders on every appended row, so animation stays off then
    // (bars would re-fire on each frame). On the done reveal we run a
    // staggered grow-in — unless the user prefers reduced motion.
    const animation: ChartOptions<"bar">["animation"] =
      streaming || reducedMotion
        ? false
        : {
            duration: 750,
            easing: "easeOutQuart",
            delay: (ctx: ScriptableContext<"bar">) =>
              ctx.type === "data" && ctx.mode === "default"
                ? ctx.dataIndex * 45 + ctx.datasetIndex * 90
                : 0,
          };

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        // Legend only earns its space when there are two series to tell apart.
        legend: {
          display: isMarried,
          labels: { color: chrome.legend, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            // Per-person values only — no summed "total" line, since the two
            // scenarios never both occur.
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${formatCurrency(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => formatCurrency(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme, streaming, reducedMotion, isMarried]);

  return (
    <div className="relative h-full">
      <Bar data={data} options={options} />
      {/* Verdigris sheen while the solve streams — CSS disables it under
          reduced motion. */}
      {streaming ? (
        <div
          aria-hidden
          className="li-shimmer-sweep pointer-events-none absolute inset-0 rounded-md"
        />
      ) : null}
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
        <span className="text-[11px] tabular text-ink-3">{Math.round(pct)}%</span>
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
