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
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { MonteCarloSummary } from "@/engine";
import { buildFanChartSeries } from "./lib/fan-chart-series";
import { formatShortCurrency } from "./lib/format";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);

interface TerminalCalloutOptions {
  p5: number;
  p50: number;
  p95: number;
}

// Renders p5 / p50 / p95 dollar labels just inside the right edge of the
// chart at the three terminal-age values. Visual parity with the mockup.
const terminalCalloutsPlugin = {
  id: "terminalCallouts",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number }; y: { getPixelForValue(v: number): number } };
      data: { labels: (string | number)[] };
    },
    _args: unknown,
    options: TerminalCalloutOptions,
  ) {
    if (!options) return;
    const { ctx, scales, data } = chart;
    const lastIdx = data.labels.length - 1;
    const x = scales.x.getPixelForValue(lastIdx);
    const entries: Array<{ y: number; label: string; color: string }> = [
      { y: scales.y.getPixelForValue(options.p95), label: formatShortCurrency(options.p95), color: "rgb(148, 163, 184)" },
      { y: scales.y.getPixelForValue(options.p50), label: formatShortCurrency(options.p50), color: "rgb(110, 231, 183)" },
      { y: scales.y.getPixelForValue(options.p5),  label: formatShortCurrency(options.p5),  color: "rgb(251, 113, 133)" },
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

const ageMarkersPlugin = {
  id: "ageMarkers",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number } };
      data: { labels: (string | number)[] };
    },
    _args: unknown,
    options: { markers?: AgeMarker[] },
  ) {
    const markers = options?.markers ?? [];
    if (markers.length === 0) return;
    const { ctx, chartArea, scales, data } = chart;
    ctx.save();
    for (const m of markers) {
      const idx = (data.labels as number[]).indexOf(m.age);
      if (idx < 0) continue;
      const x = scales.x.getPixelForValue(idx);
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

ChartJS.register(terminalCalloutsPlugin, ageMarkersPlugin);

interface FanChartProps {
  summary: MonteCarloSummary;
  deterministic: number[] | undefined;
  ageMarkers: AgeMarker[];
}

export function FanChart({ summary, deterministic, ageMarkers }: FanChartProps) {
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
        callbacks: {
          title: (items: Array<{ label: string }>) => `Age ${items[0]?.label ?? ""}`,
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }): string | void => {
            const name = ctx.dataset.label ?? "";
            if (name === "p5-baseline" || name === "p20-baseline") return;
            const y = ctx.parsed.y;
            return `${name}: ${formatShortCurrency(y ?? 0)}`;
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
        ? { p5: ending.p5, p50: ending.p50, p95: ending.p95 }
        : undefined,
      ageMarkers: { markers: ageMarkers },
    },
  } as ChartOptions<"line">;

  return (
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-100">Retirement Success Probability</h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400/60" /> 5th–95th percentile
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" /> 20th–80th percentile
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-emerald-300" /> Median
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-slate-400" style={{ borderTop: "2px dashed" }} /> Cash-flow projection
          </span>
        </div>
      </div>
      <div className="relative h-[400px]">
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md bg-slate-950/80 ring-1 ring-slate-700 px-3 py-1.5 text-center">
          <div className="text-[11px] font-semibold text-slate-100">Current Projection</div>
          <div className="text-[10px] text-slate-400">90% Confidence Interval</div>
        </div>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
