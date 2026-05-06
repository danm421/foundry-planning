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
import { formatShortCurrency, formatInteger, formatPercent } from "./lib/format";
import { PromoteButton } from "./promote-button";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface BinRange {
  min: number;
  max: number;
}

// Convert a raw value to an x-pixel using the histogram's category scale.
// Locates the bin the value falls in, then linearly interpolates within it
// using the value's position in [bin.min, bin.max). Values below/above the
// chart domain are clamped to the first/last bin's outer edge.
function valueToPixel(
  value: number,
  bins: BinRange[],
  scaleX: { getPixelForValue(v: number): number },
): number {
  if (bins.length === 0) return 0;
  let idx = bins.findIndex((b) => value >= b.min && value < b.max);
  if (idx < 0) {
    if (value < bins[0].min) idx = 0;
    else idx = bins.length - 1;
  }
  const center = scaleX.getPixelForValue(idx);
  const neighbor = idx + 1 < bins.length
    ? scaleX.getPixelForValue(idx + 1)
    : scaleX.getPixelForValue(idx - 1);
  const halfWidth = Math.abs(neighbor - center) / 2;
  const bin = bins[idx];
  const span = bin.max - bin.min;
  const frac = span > 0 ? (value - bin.min) / span : 0.5;
  // Clamp the fractional offset so off-domain values pin to the bin edge.
  const clamped = Math.max(0, Math.min(1, frac));
  return center - halfWidth + clamped * 2 * halfWidth;
}

interface SDMarkerOptions {
  bins: BinRange[];
  minus2: number;
  minus1: number;
  mean: number;
  plus1: number;
  plus2: number;
}

// Renders shaded ±1σ and ±2σ background bands behind the histogram bars,
// plus thin dashed verticals at each σ boundary and the mean. Drawing this
// before datasets keeps the bars on top.
const sdBandsPlugin = {
  id: "sdBands",
  beforeDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number } };
    },
    _args: unknown,
    options: SDMarkerOptions | undefined,
  ) {
    // This plugin is registered globally, so it fires on every Chart.js chart
    // in the app. Bail out if any required option is missing — only the
    // terminal-histogram chart configures `sdBands`, so for FanChart and
    // LongevityChart this guard ensures we no-op cleanly instead of crashing.
    if (!options || !Array.isArray(options.bins) || options.bins.length === 0) return;
    if (!Number.isFinite(options.mean)) return;
    const { ctx, chartArea, scales } = chart;
    const { bins, minus2, minus1, mean, plus1, plus2 } = options;

    const xMinus2 = valueToPixel(minus2, bins, scales.x);
    const xMinus1 = valueToPixel(minus1, bins, scales.x);
    const xMean = valueToPixel(mean, bins, scales.x);
    const xPlus1 = valueToPixel(plus1, bins, scales.x);
    const xPlus2 = valueToPixel(plus2, bins, scales.x);

    const top = chartArea.top;
    const height = chartArea.bottom - chartArea.top;

    ctx.save();
    // ±2σ outer band — very faint
    ctx.fillStyle = "rgba(110, 231, 183, 0.06)";
    ctx.fillRect(xMinus2, top, xMinus1 - xMinus2, height);
    ctx.fillRect(xPlus1, top, xPlus2 - xPlus1, height);
    // ±1σ inner band — slightly more visible
    ctx.fillStyle = "rgba(110, 231, 183, 0.12)";
    ctx.fillRect(xMinus1, top, xPlus1 - xMinus1, height);

    // Boundary verticals
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    for (const x of [xMinus2, xMinus1, xPlus1, xPlus2]) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    // Mean line — solid, more prominent
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(226, 232, 240, 0.7)";
    ctx.beginPath();
    ctx.moveTo(xMean, top);
    ctx.lineTo(xMean, chartArea.bottom);
    ctx.stroke();

    // Σ-band labels above the bars
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgb(148, 163, 184)";
    const labelY = top - 2;
    ctx.fillText("−2σ", xMinus2, labelY);
    ctx.fillText("−1σ", xMinus1, labelY);
    ctx.fillStyle = "rgb(226, 232, 240)";
    ctx.fillText("Mean", xMean, labelY);
    ctx.fillStyle = "rgb(148, 163, 184)";
    ctx.fillText("+1σ", xPlus1, labelY);
    ctx.fillText("+2σ", xPlus2, labelY);

    ctx.restore();
  },
};

ChartJS.register(sdBandsPlugin);

const ZONE_FAILED = "rgba(244, 63, 94, 0.85)"; // rose-500
const ZONE_DEPLETED = "rgba(251, 146, 60, 0.85)"; // orange-400
const ZONE_PRESERVED = "rgba(52, 211, 153, 0.85)"; // emerald-400

function classifyBin(
  binMidpoint: number,
  threshold: number,
  startingBalance: number | undefined,
): "failed" | "depleted" | "preserved" {
  if (binMidpoint < threshold) return "failed";
  if (startingBalance != null && binMidpoint < startingBalance) return "depleted";
  return "preserved";
}

interface TerminalHistogramProps {
  endingValues: number[];
  trialsRun: number;
  /** Failure threshold — bars below this are colored as a "ran out" zone. */
  requiredMinimumAssetLevel?: number;
  /** Plan-start liquid balance — bars below this but above threshold are colored
   *  as a "depleted" zone. Omit to suppress the amber zone. */
  startingLiquidBalance?: number;
  variant?: "main" | "compact";
  onPromote?: () => void;
}

export function TerminalHistogram({
  endingValues,
  trialsRun,
  requiredMinimumAssetLevel = 0,
  startingLiquidBalance,
  variant = "compact",
  onPromote,
}: TerminalHistogramProps) {
  const isMain = variant === "main";
  const series = useMemo(() => buildHistogramSeries(endingValues), [endingValues]);

  const failedCount = useMemo(
    () => endingValues.reduce((n, v) => (v <= requiredMinimumAssetLevel ? n + 1 : n), 0),
    [endingValues, requiredMinimumAssetLevel],
  );

  if (series.bins.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Ending Portfolio Distribution</h3>
        <p className="text-sm text-slate-400">No trial data available.</p>
      </section>
    );
  }

  const failureRate = trialsRun > 0 ? failedCount / trialsRun : 0;
  const sd = series.sd;
  const within1Pct = trialsRun > 0 ? sd.countWithin1 / trialsRun : 0;
  const within2Pct = trialsRun > 0 ? sd.countWithin2 / trialsRun : 0;

  const data = {
    labels: series.bins.map((b) => formatShortCurrency(b.max)),
    datasets: [
      {
        label: "Count",
        data: series.bins.map((b) => b.count),
        backgroundColor: series.bins.map((b) => {
          const mid = (b.min + b.max) / 2;
          const zone = classifyBin(mid, requiredMinimumAssetLevel, startingLiquidBalance);
          if (zone === "failed") return ZONE_FAILED;
          if (zone === "depleted") return ZONE_DEPLETED;
          return ZONE_PRESERVED;
        }),
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 0.96,
      },
    ],
  };

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 18 } },
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
          label: (ctx: { parsed: { y: number | null } }): string | void => {
            const count = ctx.parsed.y ?? 0;
            const pct = trialsRun > 0 ? count / trialsRun : 0;
            return `${count} trials (${formatPercent(pct)})`;
          },
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
          maxTicksLimit: isMain ? 8 : 5,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(148, 163, 184, 0.08)" },
        ticks: {
          color: "rgb(148, 163, 184)",
          font: { size: 10 },
          maxTicksLimit: 4,
          callback: (v: number | string) => {
            const n = typeof v === "string" ? parseFloat(v) : v;
            return Number.isInteger(n) ? formatInteger(n) : "";
          },
        },
        title: isMain
          ? { display: true, text: "Trials", color: "rgb(148, 163, 184)", font: { size: 10 } }
          : { display: false },
      },
    },
  } satisfies ChartOptions<"bar">;

  const options = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      sdBands: {
        bins: series.bins,
        minus2: sd.minus2,
        minus1: sd.minus1,
        mean: sd.mean,
        plus1: sd.plus1,
        plus2: sd.plus2,
      },
    },
  } as ChartOptions<"bar">;

  const showZoneLegend =
    startingLiquidBalance != null && startingLiquidBalance > requiredMinimumAssetLevel;

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h3
          className={
            isMain
              ? "text-base font-semibold text-slate-100"
              : "text-sm font-semibold text-slate-100"
          }
        >
          Ending Portfolio Distribution
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">N = {formatInteger(trialsRun)}</span>
          {!isMain && onPromote && <PromoteButton onPromote={onPromote} />}
        </div>
      </div>

      {isMain ? (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <Stat label="Mean" value={formatShortCurrency(sd.mean)} tone="slate" />
            <Stat
              label={`±1σ range • ${formatPercent(within1Pct)}`}
              value={`${formatShortCurrency(Math.max(0, sd.minus1))} – ${formatShortCurrency(sd.plus1)}`}
              sub={`${formatInteger(sd.countWithin1)} trials`}
              tone="emerald"
            />
            <Stat
              label={`±2σ range • ${formatPercent(within2Pct)}`}
              value={`${formatShortCurrency(Math.max(0, sd.minus2))} – ${formatShortCurrency(sd.plus2)}`}
              sub={`${formatInteger(sd.countWithin2)} trials`}
              tone="emerald"
            />
            <Stat
              label="Ran out of money"
              value={formatPercent(failureRate)}
              sub={`${formatInteger(failedCount)} of ${formatInteger(trialsRun)}`}
              tone={failureRate > 0.1 ? "rose" : failureRate > 0.05 ? "amber" : "emerald"}
            />
          </div>
          <div className="text-[11px] text-slate-500 mb-1 tabular-nums">
            5th {formatShortCurrency(series.p5)}
            <span className="mx-1.5 text-slate-700">·</span>
            Median {formatShortCurrency(series.p50)}
            <span className="mx-1.5 text-slate-700">·</span>
            95th {formatShortCurrency(series.p95)}
            <span className="mx-1.5 text-slate-700">·</span>
            σ {formatShortCurrency(sd.stdDev)}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400 mb-2 tabular-nums">
          <span className="text-slate-200">Mean {formatShortCurrency(sd.mean)}</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span>
            ±1σ {formatShortCurrency(Math.max(0, sd.minus1))}–{formatShortCurrency(sd.plus1)}
          </span>
        </p>
      )}

      <div className={isMain ? "h-[360px]" : "h-[220px]"}>
        <Bar data={data} options={options} />
      </div>

      {(series.belowDomainCount > 0 || series.aboveDomainCount > 0) && (
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          {series.belowDomainCount > 0 && (
            <span>
              ← {formatInteger(series.belowDomainCount)} trial
              {series.belowDomainCount === 1 ? "" : "s"} below shown range
            </span>
          )}
          {series.belowDomainCount > 0 && series.aboveDomainCount > 0 && (
            <span className="mx-2">·</span>
          )}
          {series.aboveDomainCount > 0 && (
            <span>
              {formatInteger(series.aboveDomainCount)} trial
              {series.aboveDomainCount === 1 ? "" : "s"} above shown range →
            </span>
          )}
        </p>
      )}

      {isMain && showZoneLegend && (
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-400">
          <LegendChip color={ZONE_FAILED} label={`Below minimum (${formatShortCurrency(requiredMinimumAssetLevel)})`} />
          <LegendChip color={ZONE_DEPLETED} label={`Below starting (${formatShortCurrency(startingLiquidBalance!)})`} />
          <LegendChip color={ZONE_PRESERVED} label="Preserved or grown" />
        </div>
      )}
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone: "rose" | "amber" | "slate" | "emerald";
}

function Stat({ label, value, sub, tone }: StatProps) {
  const toneClass = {
    rose: "text-rose-300",
    amber: "text-amber-300",
    slate: "text-slate-100",
    emerald: "text-emerald-300",
  }[tone];
  return (
    <div className="rounded-md bg-slate-950/40 ring-1 ring-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 tabular-nums">{sub}</div>}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
