"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { buildHistogramSeries } from "./lib/terminal-histogram-series";
import { formatShortCurrency, formatInteger } from "./lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface HistMarkerOptions {
  values: Array<{ x: number; color: string; width: number }>;
  bins: Array<{ min: number; max: number }>;
}

const histMarkersPlugin = {
  id: "histMarkers",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number };
      scales: { x: { getPixelForValue(v: number): number } };
    },
    _args: unknown,
    options: HistMarkerOptions,
  ) {
    if (!options?.values || options.bins.length === 0) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    for (const m of options.values) {
      let idx = options.bins.findIndex((b) => m.x >= b.min && m.x <= b.max);
      if (idx < 0) idx = m.x < options.bins[0].min ? 0 : options.bins.length - 1;
      const x = scales.x.getPixelForValue(idx);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};

ChartJS.register(histMarkersPlugin);

interface TerminalHistogramProps {
  endingValues: number[];
  trialsRun: number;
}

export function TerminalHistogram({ endingValues, trialsRun }: TerminalHistogramProps) {
  const series = useMemo(() => buildHistogramSeries(endingValues), [endingValues]);

  if (series.bins.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Ending Portfolio Distribution</h3>
        <p className="text-sm text-slate-500">No trial data available.</p>
      </section>
    );
  }

  const data = {
    labels: series.bins.map((b) => formatShortCurrency((b.min + b.max) / 2)),
    datasets: [
      {
        label: "Count",
        data: series.bins.map((b) => b.count),
        backgroundColor: "rgba(52, 211, 153, 0.6)",
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
      },
    ],
  };

  // Base options typed strictly against ChartOptions<"bar">
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        callbacks: {
          title: (items: Array<{ dataIndex: number }>) => {
            const b = series.bins[items[0]?.dataIndex ?? 0];
            return `${formatShortCurrency(b.min)} – ${formatShortCurrency(b.max)}`;
          },
          label: (ctx: { parsed: { y: number | null } }): string | void =>
            `${ctx.parsed.y ?? 0} trials`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "rgb(148, 163, 184)",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
        },
      },
      y: { display: false, grid: { display: false } },
    },
  } satisfies ChartOptions<"bar">;

  // Extend with custom plugin options — chart.js forwards unknown plugin keys
  // to registered plugins by name at runtime; we type them separately to keep
  // the base options block strictly typed.
  const options = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      histMarkers: {
        bins: series.bins,
        values: [
          { x: series.p5, color: "rgb(251, 113, 133)", width: 1 },
          { x: series.p50, color: "rgb(110, 231, 183)", width: 2 },
          { x: series.p95, color: "rgb(148, 163, 184)", width: 1 },
        ],
      },
    },
  } as ChartOptions<"bar">;

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Ending Portfolio Distribution</h3>
        <span className="text-[11px] text-slate-500">N = {formatInteger(trialsRun)} trials</span>
      </div>
      <div className="h-[220px]">
        <Bar data={data} options={options} />
      </div>
    </section>
  );
}
