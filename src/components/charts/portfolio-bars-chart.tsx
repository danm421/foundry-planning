"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";

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

/**
 * Liquid portfolio total for cash-flow framing: taxable + cash + retirement
 * + life insurance cash value. Excludes real estate and business assets —
 * advisors think of cash flow against the investable portfolio, not the
 * household's outside-the-estate holdings.
 */
export function liquidPortfolioTotal(y: ProjectionYear): number {
  return (
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal +
    y.portfolioAssets.lifeInsuranceTotal
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface PortfolioBarsChartProps {
  /** The scenario (or base) projection years to display. */
  current: ProjectionYear[];
  /**
   * Base-case years used to compute delta overlay bars. When provided the
   * chart renders three stacked datasets (blue floor + green cap + gray cap).
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
  // Apply yearRange filter when provided.
  const visibleYears = useMemo(() => {
    if (!yearRange) return current;
    return current.filter(
      (y) => y.year >= yearRange.start && y.year <= yearRange.end,
    );
  }, [current, yearRange]);

  const chartLabels = visibleYears.map((y) => String(y.year));

  // Build a year → liquid-total map for the baseline so we can compute deltas.
  const baseLiquidByYear = useMemo(() => {
    if (!baseline) return null;
    const map = new Map<number, number>();
    for (const y of baseline) map.set(y.year, liquidPortfolioTotal(y));
    return map;
  }, [baseline]);

  const showDelta = baseLiquidByYear !== null;

  const chartData = showDelta
    ? {
        labels: chartLabels,
        datasets: [
          {
            label: "Common floor (vs base case)",
            data: visibleYears.map((y) => {
              const scenario = liquidPortfolioTotal(y);
              const base = baseLiquidByYear.get(y.year) ?? scenario;
              return Math.min(scenario, base);
            }),
            backgroundColor: "#2563eb",
            stack: "portfolio",
          },
          {
            label: "Scenario ahead of base",
            data: visibleYears.map((y) => {
              const scenario = liquidPortfolioTotal(y);
              const base = baseLiquidByYear.get(y.year) ?? scenario;
              return Math.max(0, scenario - base);
            }),
            backgroundColor: "#059669",
            stack: "portfolio",
          },
          {
            label: "Base case ahead of scenario",
            data: visibleYears.map((y) => {
              const scenario = liquidPortfolioTotal(y);
              const base = baseLiquidByYear.get(y.year) ?? scenario;
              return Math.max(0, base - scenario);
            }),
            backgroundColor: "#9ca3af",
            stack: "portfolio",
          },
        ],
      }
    : {
        labels: chartLabels,
        datasets: [
          {
            label: "Total Portfolio Assets",
            data: visibleYears.map(liquidPortfolioTotal),
            backgroundColor: "#2563eb",
            borderColor: "#2563eb",
            borderWidth: 1,
          },
        ],
      };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 20 } },
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
            `${ctx.dataset.label}: ${fmtNum(Number(ctx.raw))}`,
        },
      },
      // Typed via `as any` to satisfy chart.js plugin options extension.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      timelineMarkers: { markers: timelineMarkers } as any,
    },
    scales: {
      x: {
        stacked: showDelta,
        ticks: { color: "#9ca3af" },
        grid: { color: "#374151" },
      },
      y: {
        stacked: showDelta,
        ticks: {
          color: "#9ca3af",
          callback: (value: unknown) => fmtNum(Number(value)),
        },
        grid: { color: "#374151" },
      },
    },
  };

  return <Bar data={chartData} options={chartOptions} />;
}
