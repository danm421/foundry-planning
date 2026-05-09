"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { MonteCarloSummary } from "@/engine";
import { buildFanChartSeries } from "./lib/fan-chart-series";
import { formatShortCurrency } from "./lib/format";
import { PromoteButton } from "./promote-button";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);


interface TerminalCalloutOptions {
  p80: number;
  p50: number;
  p20: number;
}

// Renders p5 / p50 / p95 dollar labels just inside the right edge of the
// chart at the three terminal-age values. Visual parity with the mockup.
const terminalCalloutsPlugin: Plugin<"line", Partial<TerminalCalloutOptions>> = {
  id: "terminalCallouts",
  afterDatasetsDraw(chart, _args, options) {
    if (
      !options ||
      !Number.isFinite(options.p80) ||
      !Number.isFinite(options.p50) ||
      !Number.isFinite(options.p20)
    ) {
      return;
    }
    const { ctx, scales, data } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;
    const labels = data.labels ?? [];
    const lastIdx = labels.length - 1;
    if (lastIdx < 0) return;
    const x = xScale.getPixelForValue(lastIdx);
    const entries: Array<{ y: number; label: string; color: string }> = [
      { y: yScale.getPixelForValue(options.p80!), label: formatShortCurrency(options.p80!), color: "rgb(52, 211, 153)" },
      { y: yScale.getPixelForValue(options.p50!), label: formatShortCurrency(options.p50!), color: "rgb(110, 231, 183)" },
      { y: yScale.getPixelForValue(options.p20!), label: formatShortCurrency(options.p20!), color: "rgb(251, 113, 133)" },
    ];
    ctx.save();
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const e of entries) {
      ctx.fillStyle = e.color;
      ctx.fillText(e.label, x + 6, e.y);
    }
    ctx.restore();
  },
};

interface AgeMarker {
  age: number;
  label: string;
  color: string;
}

const ageMarkersPlugin: Plugin<"line", { markers?: AgeMarker[] }> = {
  id: "ageMarkers",
  afterDatasetsDraw(chart, _args, options) {
    const markers = options?.markers ?? [];
    if (markers.length === 0) return;
    const { ctx, chartArea, scales, data } = chart;
    const xScale = scales.x;
    if (!xScale) return;
    ctx.save();
    for (const m of markers) {
      const idx = (data.labels as number[] | undefined)?.indexOf(m.age) ?? -1;
      if (idx < 0) continue;
      const x = xScale.getPixelForValue(idx);
      ctx.strokeStyle = m.color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 8);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
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

interface FanChartProps {
  summary: MonteCarloSummary;
  deterministic: number[] | undefined;
  ageMarkers: AgeMarker[];
  variant?: "main" | "compact";
  onPromote?: () => void;
}

export function FanChart({
  summary,
  deterministic,
  ageMarkers,
  variant = "main",
  onPromote,
}: FanChartProps) {
  const isCompact = variant === "compact";
  const { ages, datasets } = useMemo(
    () => buildFanChartSeries(summary.byYear, deterministic),
    [summary.byYear, deterministic],
  );

  const ending = summary.byYear[summary.byYear.length - 1]?.balance;

  const data = {
    labels: ages,
    datasets,
  };

  // Base options typed strictly against ChartOptions<"line">
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    layout: { padding: { right: 56, top: 16 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        borderColor: "rgb(30, 41, 59)",
        borderWidth: 1,
        padding: 10,
        boxWidth: 20,
        boxHeight: 10,
        boxPadding: 8,
        itemSort: (
          a: { dataset: { label?: string } },
          b: { dataset: { label?: string } },
        ) => {
          const orderMap: Record<string, number> = {
            "Above average (80th)": 0,
            "Median": 1,
            "Below average (20th)": 2,
            "Cash-flow projection": 3,
          };
          const ai = orderMap[a.dataset.label ?? ""] ?? 99;
          const bi = orderMap[b.dataset.label ?? ""] ?? 99;
          return ai - bi;
        },
        callbacks: {
          title: (items: Array<{ label: string }>) => `Age ${items[0]?.label ?? ""}`,
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }): string | void => {
            const name = ctx.dataset.label ?? "";
            const y = ctx.parsed.y;
            return `${name}: ${formatShortCurrency(y ?? 0)}`;
          },
          // Render each swatch using the dataset's line color (not the faint band fill).
          // Dashed-line datasets render as a transparent box with a dashed border so the
          // swatch visually mirrors the line on the chart. Cast through `unknown` because
          // chart.js types `borderColor`/`borderDash` as scriptable arrays, but our
          // datasets always store plain string/number[] values.
          labelColor: (ctx) => {
            const ds = ctx.dataset as unknown as { borderColor?: string; borderDash?: number[] };
            const color = ds.borderColor ?? "rgb(148, 163, 184)";
            const dash = ds.borderDash;
            if (Array.isArray(dash) && dash.length >= 2) {
              return {
                backgroundColor: "transparent",
                borderColor: color,
                borderWidth: 2,
                borderDash: [dash[0], dash[1]] as [number, number],
              };
            }
            return {
              backgroundColor: color,
              borderColor: color,
              borderWidth: 2,
            };
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Age", color: "rgb(148, 163, 184)" },
        grid: { color: "rgba(30, 41, 59, 0.6)" },
        ticks: { color: "rgb(148, 163, 184)" },
      },
      y: {
        type: "linear" as const,
        beginAtZero: true,
        title: { display: true, text: "Portfolio Value", color: "rgb(148, 163, 184)" },
        grid: { color: "rgba(30, 41, 59, 0.6)" },
        ticks: {
          color: "rgb(148, 163, 184)",
          callback: (v: number | string) => formatShortCurrency(typeof v === "string" ? parseFloat(v) : v),
        },
      },
    },
  } satisfies ChartOptions<"line">;

  // Extend with custom plugin options — chart.js forwards unknown plugin keys
  // to registered plugins by name at runtime; we type them separately to keep
  // the base options block strictly typed.
  const options = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      terminalCallouts: ending
        ? { p80: ending.p80, p50: ending.p50, p20: ending.p20 }
        : undefined,
      ageMarkers: { markers: ageMarkers },
    },
  } as ChartOptions<"line">;

  return (
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2
          className={
            isCompact
              ? "text-sm font-semibold text-slate-100"
              : "text-base font-semibold text-slate-100"
          }
        >
          Retirement Success Probability
        </h2>
        {!isCompact && (
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 bg-emerald-400" /> Above average (80th)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 bg-emerald-300" /> Median
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 bg-rose-400" /> Below average (20th)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 bg-slate-400" style={{ borderTop: "2px dashed" }} /> Cash-flow projection
            </span>
          </div>
        )}
        {isCompact && onPromote && <PromoteButton onPromote={onPromote} />}
      </div>
      <div className={isCompact ? "relative h-[220px]" : "relative h-[400px]"}>
        <Line
          data={data}
          options={options}
          plugins={[terminalCalloutsPlugin, ageMarkersPlugin]}
        />
      </div>
    </div>
  );
}
