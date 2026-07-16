"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type ScriptableContext,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";
import {
  buildPortfolioDeltaSegments,
  buildPortfolioSingleSeries,
  liquidPortfolioTotal,
} from "./portfolio-bars-data";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { data as brandData, dataLight as brandDataLight } from "@/brand";

// Re-exported for existing importers (solver, monte-carlo report, etc.).
export { liquidPortfolioTotal };

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Timeline-markers plugin (verbatim copy from cashflow-report.tsx) ─────────
// Draws vertical dashed markers at specific data indices with a short label and
// a colored cap at the top. Used to show retirement and life-expectancy events
// for each client on the cash-flow and portfolio charts. Enable via:
//   options.plugins.timelineMarkers = { markers: [{ yearIndex, label, color }] }

export interface PortfolioBarsTimelineMarker {
  yearIndex: number;
  label: string;
  color: string;
}

const timelineMarkersPlugin = {
  id: "timelineMarkers",
  afterDatasetsDraw(chart: {
    ctx: CanvasRenderingContext2D;
    chartArea: { top: number; bottom: number; left: number; right: number };
    scales: { x: { getPixelForValue(v: number): number } };
  }, _args: unknown, options: { markers?: PortfolioBarsTimelineMarker[] }) {
    const { ctx, chartArea, scales } = chart;
    const markers = options?.markers ?? [];
    if (markers.length === 0) return;
    ctx.save();
    for (const m of markers) {
      const x = scales.x.getPixelForValue(m.yearIndex);
      if (x < chartArea.left - 1 || x > chartArea.right + 1) continue;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 8);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Cap + label at the top
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, chartArea.top + 6, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(m.label, x, chartArea.top - 2);
    }
    ctx.restore();
  },
};

// Guard against double-registration (chart.js registry is global).
if (!ChartJS.registry.plugins.get("timelineMarkers")) {
  ChartJS.register(timelineMarkersPlugin);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtNum(v: number) {
  return fmt.format(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface PortfolioBarsChartProps {
  /** The scenario (or base) projection years to display. */
  current: ProjectionYear[];
  /**
   * Base-case years used to compute delta overlay bars. When provided the
   * chart renders three stacked datasets (blue floor + good cap + teal cap).
   * When absent (or null) the chart renders a single blue bar series.
   */
  baseline?: ProjectionYear[] | null;
  /** Timeline event markers (retirement, life expectancy, etc.). */
  timelineMarkers?: PortfolioBarsTimelineMarker[];
  /** Visible year window — used to clip the x-axis to the slider selection. */
  yearRange?: { start: number; end: number };
}

export function PortfolioBarsChart({
  current,
  baseline,
  timelineMarkers = [],
  yearRange,
}: PortfolioBarsChartProps) {
  const theme = useThemeName();
  const reducedMotion = usePrefersReducedMotion();

  // Apply yearRange filter when provided.
  const visibleYears = useMemo(() => {
    if (!yearRange) return current;
    return current.filter(
      (y) => y.year >= yearRange.start && y.year <= yearRange.end,
    );
  }, [current, yearRange]);

  const chartLabels = useMemo(
    () => visibleYears.map((y) => String(y.year)),
    [visibleYears],
  );

  // Build a year → liquid-total map for the baseline so we can compute deltas.
  const baseLiquidByYear = useMemo(() => {
    if (!baseline) return null;
    const map = new Map<number, number>();
    for (const y of baseline) map.set(y.year, liquidPortfolioTotal(y));
    return map;
  }, [baseline]);

  const showDelta = baseLiquidByYear !== null;

  // Years whose scenario liquid total is negative render as a flat (0-height)
  // bar — the tooltip surfaces the real negative number on hover. `scenarioTotals`
  // carries the raw values (negatives included) for that tooltip.
  const { chartData, scenarioTotals } = useMemo(() => {
    const palette = theme === "light" ? brandDataLight : brandData;

    if (baseLiquidByYear) {
      const seg = buildPortfolioDeltaSegments(visibleYears, baseLiquidByYear);
      return {
        scenarioTotals: seg.scenarioTotals,
        chartData: {
          labels: chartLabels,
          datasets: [
            {
              label: "Common floor (vs base case)",
              data: seg.floor,
              backgroundColor: palette.blue,
              stack: "portfolio",
            },
            {
              label: "Scenario ahead of base",
              data: seg.scenarioAhead,
              backgroundColor: palette.green,
              stack: "portfolio",
            },
            {
              label: "Base case ahead of scenario",
              data: seg.baseAhead,
              backgroundColor: palette.grey,
              stack: "portfolio",
            },
          ],
        },
      };
    }
    const series = buildPortfolioSingleSeries(visibleYears);
    return {
      scenarioTotals: series.scenarioTotals,
      chartData: {
        labels: chartLabels,
        datasets: [
          {
            label: "Total Portfolio Assets",
            data: series.data,
            backgroundColor: palette.blue,
            borderColor: palette.blue,
            borderWidth: 1,
          },
        ],
      },
    };
  }, [visibleYears, baseLiquidByYear, chartLabels, theme]);

  const chartOptions = useMemo(() => {
    const chrome = chartChrome(theme);

    // Scenario changes sweep left→right: each year's bar starts a beat after
    // the previous one, so the green/grey deltas read as the change
    // propagating through the plan rather than every bar lurching at once.
    // All three stacked segments of a bar share one delay — staggering by
    // dataset would detach the caps from the floor mid-flight. The sweep is
    // normalized to ~250ms end-to-end regardless of how many years are on
    // screen, and it re-fires on every recompute, so it stays quick.
    const animation: ChartOptions<"bar">["animation"] = reducedMotion
      ? false
      : {
          duration: 550,
          easing: "easeOutQuart",
          delay: (ctx: ScriptableContext<"bar">) => {
            if (ctx.type !== "data" || ctx.mode !== "default") return 0;
            const n = ctx.chart.data.labels?.length ?? 1;
            return n > 1 ? (ctx.dataIndex / (n - 1)) * 250 : 0;
          },
        };

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation,
      // Top padding only exists to clear the timeline-marker labels drawn above
      // the plot. With no markers (e.g. the solver chart) that 20px is dead
      // space — drop it so the chart sits tight under the header when pinned.
      layout: { padding: { top: timelineMarkers.length > 0 ? 20 : 6 } },
      // Index mode keeps the tooltip reachable on flat (0-height) underwater
      // years, where there is no bar to hover.
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
            label: (ctx: {
              dataIndex: number;
              dataset: { label?: string };
              raw: unknown;
            }) => {
              const total = scenarioTotals[ctx.dataIndex];
              // Base view: an underwater year's lone bar is flat — relabel it to
              // the real negative total (delta view handles this via afterBody).
              if (!showDelta && total < 0) {
                return `Total Portfolio Assets: ${fmtNum(total)}`;
              }
              return `${ctx.dataset.label}: ${fmtNum(Number(ctx.raw))}`;
            },
            afterBody: (items: { dataIndex: number }[]) => {
              if (!showDelta) return [];
              const idx = items[0]?.dataIndex;
              const total = idx == null ? 0 : scenarioTotals[idx];
              // Delta view: the flat blue floor is filtered out — note the
              // depleted scenario beside the still-full-height base-case bar.
              return total < 0
                ? [`Scenario portfolio depleted: ${fmtNum(total)}`]
                : [];
            },
          },
          // Drop zero-height segments so the tooltip stays uncluttered. Base view
          // always keeps its single row (its label carries the underwater value).
          filter: (ctx: { raw: unknown }) =>
            showDelta ? Number(ctx.raw) !== 0 : true,
        },
        // Typed via `as any` to satisfy chart.js plugin options extension.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timelineMarkers: { markers: timelineMarkers } as any,
      },
      scales: {
        x: {
          stacked: showDelta,
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: showDelta,
          ticks: {
            color: chrome.tick,
            callback: (value: unknown) => fmtNum(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme, reducedMotion, showDelta, scenarioTotals, timelineMarkers]);

  return <Bar data={chartData} options={chartOptions} />;
}
